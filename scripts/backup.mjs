import { DatabaseSync } from 'node:sqlite';
import { existsSync, chmodSync } from 'node:fs';
import path from 'node:path';
const source = path.resolve(process.env.ENTITY_DATA_DIR || 'data', 'entity.sqlite');
const target = process.argv[2] && path.resolve(process.argv[2]);
if (!target || existsSync(target) || !existsSync(source))
  throw new Error('Cần đường dẫn bản sao mới chưa tồn tại và database đã khởi tạo.');
const db = new DatabaseSync(source);
db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
db.close();
chmodSync(target, 0o600);
const check = new DatabaseSync(target, { readOnly: true });
if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok')
  throw new Error('Bản sao không qua kiểm tra toàn vẹn.');
check.close();
console.log('Đã tạo và kiểm tra bản sao SQLite. Giữ khóa vault riêng để khôi phục tài khoản.');
