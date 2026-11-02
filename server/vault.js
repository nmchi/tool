import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';

export function createVault(dataDir, suppliedKey = process.env.ENTITY_VAULT_KEY) {
  let key;
  if (suppliedKey) {
    if (!/^[a-f0-9]{64}$/i.test(suppliedKey))
      throw new Error('ENTITY_VAULT_KEY phải có 64 ký tự hex.');
    key = Buffer.from(suppliedKey, 'hex');
  } else {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const file = path.join(dataDir, '.vault-key');
    if (!existsSync(file)) {
      try {
        writeFileSync(file, randomBytes(32), { mode: 0o600, flag: 'wx' });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    key = readFileSync(file);
    chmodSync(file, 0o600);
    if (key.length !== 32)
      throw new Error('Khóa mã hóa không hợp lệ. Không thay khóa khi đã có tài khoản.');
  }
  return {
    encrypt(value, accountId) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(accountId));
      const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return JSON.stringify({
        v: 1,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: body.toString('base64'),
      });
    },
    decrypt(value, accountId) {
      const box = JSON.parse(value);
      if (box.v !== 1) throw new Error('Định dạng kho tài khoản không được hỗ trợ.');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
      decipher.setAAD(Buffer.from(accountId));
      decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(box.data, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}
