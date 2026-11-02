import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/store.js';
import { createVault } from '../server/vault.js';
import { projectInput } from './helpers.js';

test('a live SQLite backup passes integrity checks and restores project data and encrypted credentials', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'entity-backup-'));
  const store = new Store(path.join(dir, 'entity.sqlite'));
  let restored;
  try {
    const project = store.createProject(projectInput());
    const vault = createVault(dir);
    store.run(
      'INSERT INTO accounts(id,project_id,platform_id,remote_id,username,profile_url,encrypted_token,verified_at) VALUES (?,?,?,?,?,?,?,?)',
      'account-id',
      project.id,
      'github',
      '42',
      'brand-one',
      'https://github.com/brand-one',
      vault.encrypt('restore-test-token', 'account-id'),
      Date.now(),
    );
    const target = path.join(dir, 'backup.sqlite');
    execFileSync(process.execPath, ['scripts/backup.mjs', target], {
      cwd: process.cwd(),
      env: { ...process.env, ENTITY_DATA_DIR: dir },
      stdio: 'pipe',
    });
    restored = new DatabaseSync(target, { readOnly: true });
    assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(restored.prepare('SELECT name FROM projects').get().name, project.name);
    const account = restored.prepare('SELECT * FROM accounts').get();
    assert.equal(
      createVault(dir).decrypt(account.encrypted_token, account.id),
      'restore-test-token',
    );
  } finally {
    restored?.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
