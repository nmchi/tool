import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVault } from '../server/vault.js';

test('vault encrypts tokens at rest, binds ciphertext to an account and survives process restart', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'entity-vault-'));
  try {
    const vault = createVault(dir);
    const encrypted = vault.encrypt('sensitive-test-token', 'account-a');
    assert.equal(encrypted.includes('sensitive-test-token'), false);
    assert.equal(createVault(dir).decrypt(encrypted, 'account-a'), 'sensitive-test-token');
    assert.throws(() => vault.decrypt(encrypted, 'account-b'));
    const box = JSON.parse(encrypted);
    box.tag = Buffer.alloc(16).toString('base64');
    assert.throws(() => vault.decrypt(JSON.stringify(box), 'account-a'));
    // Windows ignores POSIX mode bits; protect the key there with ENTITY_VAULT_KEY or NTFS ACLs.
    if (process.platform !== 'win32')
      assert.equal(statSync(path.join(dir, '.vault-key')).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
