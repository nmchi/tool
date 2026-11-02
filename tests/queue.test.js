import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.js';
import { Worker, nextCheck } from '../server/worker.js';
import { RemoteError } from '../server/network.js';
import { setupStore, projectInput, enqueue, healthy } from './helpers.js';

test('bulk jobs are independent across projects and active pair-kind duplicates are skipped', () => {
  const { store, project } = setupStore();
  try {
    const second = store.createProject(projectInput('two'));
    const a = store.createBatch({
      name: 'A',
      project_ids: [project.id, second.id],
      platform_ids: ['github', 'gitlab'],
      kind: 'verify',
    });
    const b = store.createBatch({
      name: 'B',
      project_ids: [project.id, second.id],
      platform_ids: ['github', 'gitlab'],
      kind: 'verify',
    });
    assert.equal(a.created, 4);
    assert.equal(b.created, 0);
    assert.equal(b.skipped, 4);
    assert.equal(store.all('SELECT * FROM jobs').length, 4);
    assert.throws(
      () => store.createProject({ ...projectInput(), website: 'http://www.one.example.com/path' }),
      /đã có dự án/,
    );
  } finally {
    store.close();
  }
});
test('claim enforces per-platform rate limits and serializes different jobs for the same pair', () => {
  const { store, project } = setupStore();
  try {
    const second = store.createProject(projectInput('two'));
    store.run("UPDATE platforms SET interval_ms=60000 WHERE id='github'");
    enqueue(store, project, 'verify', 'github');
    enqueue(store, project, 'sync', 'github');
    enqueue(store, second, 'verify', 'github');
    const first = store.claim('worker-a', 2);
    assert.ok(first);
    assert.equal(store.claim('worker-b', 2), null);
    store.run('UPDATE rate_limits SET next_at=0');
    const next = store.claim('worker-b', 2);
    assert.equal(next.project_id, second.id);
    assert.equal(store.claim('worker-c', 2), null);
  } finally {
    store.close();
  }
});
test('paused batches do not claim; cancel preserves an in-flight operation and cancels pending work', () => {
  const { store, project } = setupStore();
  try {
    const b = store.createBatch({
      name: 'batch',
      project_ids: [project.id],
      platform_ids: ['github', 'gitlab'],
      kind: 'verify',
    });
    store.batchAction(b.id, 'pause');
    assert.equal(store.claim('a'), null);
    store.batchAction(b.id, 'resume');
    const job = store.claim('a');
    assert.ok(job);
    store.batchAction(b.id, 'cancel');
    assert.equal(store.require('jobs', job.id).status, 'running');
    assert.equal(store.all("SELECT * FROM jobs WHERE status='cancelled'").length, 1);
    assert.equal(store.claim('b'), null);
    store.finish(job, { status: 'succeeded' });
    assert.equal(store.require('jobs', job.id).status, 'succeeded');
  } finally {
    store.close();
  }
});
test('persistent queue recovers only expired leases after restart and never resets completed work', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'entity-queue-'));
  let store = new Store(path.join(dir, 'test.sqlite'));
  try {
    const project = store.createProject(projectInput());
    enqueue(store, project);
    const job = store.claim('old-worker');
    store.close();
    store = new Store(path.join(dir, 'test.sqlite'));
    store.recover();
    assert.equal(store.require('jobs', job.id).status, 'running');
    store.run('UPDATE jobs SET lease_until=? WHERE id=?', Date.now() - 1, job.id);
    store.run('UPDATE rate_limits SET next_at=0');
    const recovered = store.claim('new-worker');
    assert.equal(recovered.id, job.id);
    assert.equal(recovered.attempts, 2);
    assert.equal(store.finish(job, { status: 'succeeded' }), false);
    store.finish(recovered, { status: 'succeeded' });
    store.recover(Date.now() + 1000000);
    assert.equal(store.require('jobs', job.id).status, 'succeeded');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('worker manual preparation waits for a URL, then verifies instead of creating another profile', async () => {
  const { store, project } = setupStore();
  const worker = new Worker(
    store,
    { verify: async () => healthy('https://about.me/brand-one') },
    {},
  );
  try {
    const created = enqueue(store, project, 'prepare', 'aboutme');
    await worker.process(store.claim(worker.id));
    assert.equal(store.require('jobs', created.id).status, 'action_required');
    assert.equal(store.all('SELECT * FROM profiles').length, 0);
    store.jobAction(created.id, 'resume', 'https://about.me/brand-one');
    await worker.process(store.claim(worker.id));
    assert.equal(store.require('jobs', created.id).status, 'succeeded');
    const profile = store.all('SELECT * FROM profiles')[0];
    assert.equal(profile.status, 'healthy');
    assert.ok(profile.next_check > profile.last_checked);
    assert.equal(store.all('SELECT * FROM profiles').length, 1);
  } finally {
    await worker.stop();
    store.close();
  }
});
test('project edits invalidate old evidence and require queued writes to use the new version explicitly', async () => {
  const { store, project } = setupStore();
  let called = false;
  const worker = new Worker(
    store,
    {
      sync: async () => {
        called = true;
      },
    },
    {},
  );
  try {
    store.putProfile(project.id, 'github', 'https://github.com/brand-one');
    store.run("UPDATE profiles SET status='healthy',backlink=1,identity_match=1");
    const job = enqueue(store, project, 'sync');
    store.updateProject(project.id, { ...projectInput(), name: 'Tên mới' });
    assert.equal(store.all('SELECT * FROM profiles')[0].status, 'unverified');
    await worker.process(store.claim(worker.id));
    assert.equal(called, false);
    assert.equal(store.require('jobs', job.id).status, 'action_required');
    store.jobAction(job.id, 'resume');
    assert.equal(store.require('jobs', job.id).project_version, 2);
  } finally {
    await worker.stop();
    store.close();
  }
});
test('transient failures retry with a shared persisted cooldown and stop after the attempt budget', async () => {
  const { store, project } = setupStore();
  const worker = new Worker(
    store,
    {
      verify: async () => {
        throw new RemoteError('Rate limited', { retryable: true, delay: 120000 });
      },
    },
    {},
  );
  try {
    store.putProfile(project.id, 'github', 'https://github.com/brand-one');
    const job = enqueue(store, project);
    await worker.process(store.claim(worker.id));
    assert.equal(store.require('jobs', job.id).status, 'retry');
    assert.ok(store.get('SELECT next_at FROM rate_limits').next_at > Date.now() + 110000);
    for (let i = 0; i < 2; i++) {
      store.run('UPDATE rate_limits SET next_at=0');
      store.run('UPDATE jobs SET available_at=0');
      await worker.process(store.claim(worker.id));
    }
    assert.equal(store.require('jobs', job.id).status, 'failed');
    assert.equal(store.all('SELECT * FROM profiles')[0].status, 'unknown');
    assert.equal(store.all('SELECT * FROM profiles')[0].backlink, null);
    assert.equal(store.all('SELECT * FROM profile_checks')[0].status, 'unknown');
    assert.ok(store.get('SELECT next_at FROM rate_limits').next_at > Date.now() + 110000);
    assert.equal(store.claim(worker.id), null);
  } finally {
    await worker.stop();
    store.close();
  }
});
test('monitoring does not duplicate open work and respects project opt-out', () => {
  const { store, project } = setupStore();
  try {
    store.putProfile(project.id, 'github', 'https://github.com/brand-one');
    store.run('UPDATE profiles SET next_check=1');
    store.run('UPDATE projects SET monitoring=0');
    store.schedule();
    assert.equal(store.all('SELECT * FROM jobs').length, 0);
    store.run('UPDATE projects SET monitoring=1');
    store.schedule();
    store.schedule();
    assert.equal(store.all('SELECT * FROM jobs').length, 1);
    const first = 100000000;
    const day = 86400000;
    assert.equal(nextCheck(first, first), first + day);
    assert.equal(nextCheck(first, first + day), first + 7 * day);
    assert.equal(nextCheck(first, first + 7 * day), first + 30 * day);
    assert.equal(nextCheck(first, first + 30 * day), first + 60 * day);
  } finally {
    store.close();
  }
});
test('changing a profile URL clears stale ownership declarations', () => {
  const { store, project } = setupStore();
  try {
    const profile = store.putProfile(project.id, 'aboutme', 'https://about.me/old');
    store.run(
      "UPDATE profiles SET owner_confirmed=1,email_verified='yes',two_factor='enabled',account_email='owner@example.com' WHERE id=?",
      profile.id,
    );
    const updated = store.putProfile(project.id, 'aboutme', 'https://about.me/new');
    assert.equal(updated.id, profile.id);
    assert.equal(updated.owner_confirmed, 0);
    assert.equal(updated.email_verified, 'unknown');
    assert.equal(updated.account_email, '');
    assert.equal(updated.status, 'unverified');
  } finally {
    store.close();
  }
});
