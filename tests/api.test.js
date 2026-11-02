import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../server/app.js';
import { createVault } from '../server/vault.js';
import { setupStore, projectInput } from './helpers.js';

async function fixture(t, accessToken = '') {
  const { store, project } = setupStore();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'entity-api-'));
  const vault = createVault(dir);
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  server.on(
    'request',
    createApp({
      store,
      vault,
      accessToken,
      port,
      connectors: {
        identity: async () => ({
          remote_id: '42',
          username: 'owned-brand',
          profile_url: 'https://github.com/owned-brand',
        }),
      },
    }),
  );
  const request = async (url, options = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/api${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Entity-Client': 'workspace',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...options.headers,
      },
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: response.status, body, text, headers: response.headers };
  };
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, project, request, port };
}

test('API persists projects, reports duplicate domains, rejects unsafe URLs and supports bulk deduplication', async (t) => {
  const { request, project } = await fixture(t);
  const create = await request('/projects', {
    method: 'POST',
    body: JSON.stringify(projectInput('two')),
  });
  assert.equal(create.status, 201);
  assert.equal(
    (await request('/projects', { method: 'POST', body: JSON.stringify(projectInput('two')) }))
      .status,
    409,
  );
  assert.equal(
    (
      await request('/projects', {
        method: 'POST',
        body: JSON.stringify({ ...projectInput('bad'), website: 'http://127.0.0.1' }),
      })
    ).status,
    400,
  );
  const body = JSON.stringify({
    name: 'Bulk',
    project_ids: [project.id, create.body.id],
    platform_ids: ['github', 'aboutme'],
    kind: 'prepare',
  });
  assert.equal((await request('/batches', { method: 'POST', body })).body.created, 4);
  assert.equal((await request('/batches', { method: 'POST', body })).body.skipped, 4);
  assert.equal((await request('/state')).body.jobs.length, 4);
});
test('catalog imports do not attach sample brand profiles; real-profile imports preserve existing URLs', async (t) => {
  const { request, project } = await fixture(t);
  const text =
    'https://new.example.com/users/other-brand\nhttps://github.com/example-brand\nhttps://www.easycounter.com/report/example.com';
  const imported = await request('/import/commit', {
    method: 'POST',
    body: JSON.stringify({ text, mode: 'catalog' }),
  });
  assert.equal(imported.body.created, 1);
  let state = (await request('/state')).body;
  assert.equal(state.profiles.length, 0);
  assert.equal(state.platforms.find((p) => p.origin === 'https://new.example.com').enabled, 0);
  const own = await request('/import/commit', {
    method: 'POST',
    body: JSON.stringify({
      text: 'https://github.com/brand-one\nhttps://github.com/another',
      mode: 'profiles',
      project_id: project.id,
    }),
  });
  assert.equal(own.body.created, 1);
  assert.equal(own.body.skipped, 1);
  state = (await request('/state')).body;
  assert.equal(state.profiles[0].url, 'https://github.com/brand-one');
  assert.equal(state.profiles[0].status, 'unverified');
});
test('account connection is ownership-checked, encrypted, isolated and excluded from state/export', async (t) => {
  const { request, store, project } = await fixture(t);
  const token = 'super-sensitive-api-token-for-test';
  const connect = await request('/accounts', {
    method: 'POST',
    body: JSON.stringify({ project_id: project.id, platform_id: 'github', token }),
  });
  assert.equal(connect.status, 201);
  assert.equal(store.all('SELECT * FROM accounts')[0].encrypted_token.includes(token), false);
  const other = store.createProject(projectInput('other'));
  const collision = await request('/accounts', {
    method: 'POST',
    body: JSON.stringify({ project_id: other.id, platform_id: 'github', token }),
  });
  assert.equal(collision.status, 409);
  assert.equal((await request('/state')).text.includes(token), false);
  assert.equal((await request('/state')).text.includes('encrypted_token'), false);
  assert.equal((await request('/export/profiles.csv')).text.includes(token), false);
  assert.equal((await request(`/accounts/${connect.body.id}`, { method: 'DELETE' })).status, 200);
  assert.equal(store.all('SELECT * FROM accounts').length, 0);
});
test('API rejects cross-origin mutations, wrong Host, absent client header and wrong workspace token', async (t) => {
  const { request, port } = await fixture(t, 'test-workspace-token-at-least-24');
  assert.equal(
    (await request('/state', { headers: { Authorization: 'Bearer wrong' } })).status,
    401,
  );
  assert.equal(
    (
      await request('/projects', {
        method: 'POST',
        headers: { Origin: 'https://evil.example.com' },
        body: '{}',
      })
    ).status,
    403,
  );
  assert.equal(
    (await request('/projects', { method: 'POST', headers: { 'X-Entity-Client': '' }, body: '{}' }))
      .status,
    403,
  );
  const invalidHost = await new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/api/state', headers: { Host: 'evil.example.com' } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(invalidHost, 403);
});
test('API cannot attach a profile on another platform or replace a URL during in-flight work', async (t) => {
  const { request, project, store } = await fixture(t);
  const body = JSON.stringify({
    project_id: project.id,
    platform_id: 'github',
    url: 'https://gitlab.com/other',
  });
  assert.equal((await request('/profiles', { method: 'POST', body })).status, 400);
  store.createBatch({
    name: 'Active',
    project_ids: [project.id],
    platform_ids: ['github'],
    kind: 'verify',
  });
  store.claim('worker');
  assert.equal(
    (
      await request('/profiles', {
        method: 'POST',
        body: JSON.stringify({
          project_id: project.id,
          platform_id: 'github',
          url: 'https://github.com/owned',
        }),
      })
    ).status,
    409,
  );
});
test('manual ownership/email/2FA declarations persist without changing public verification status', async (t) => {
  const { request, project, store } = await fixture(t);
  const profile = store.putProfile(project.id, 'github', 'https://github.com/brand-one');
  const result = await request(`/profiles/${profile.id}/checklist`, {
    method: 'PATCH',
    body: JSON.stringify({
      account_email: 'owner@example.com',
      email_verified: 'yes',
      two_factor: 'enabled',
      owner_confirmed: true,
    }),
  });
  assert.equal(result.status, 200);
  const updated = (await request('/state')).body.profiles[0];
  assert.equal(updated.owner_confirmed, 1);
  assert.equal(updated.email_verified, 'yes');
  assert.equal(updated.status, 'unverified');
  assert.equal(updated.last_checked, null);
  assert.deepEqual((await request(`/profiles/${profile.id}/history`)).body, []);
});
