import path from 'node:path';
import { Store } from './store.js';
import { createVault } from './vault.js';
import { createNetwork } from './network.js';
import { Connectors } from './connectors.js';
import { Worker } from './worker.js';
import { createApp } from './app.js';
import { createMail } from './mail.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4310);
const accessToken = process.env.ENTITY_ACCESS_TOKEN || '';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT không hợp lệ.');
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && accessToken.length < 24)
  throw new Error('Cần ENTITY_ACCESS_TOKEN có ít nhất 24 ký tự khi mở truy cập ngoài máy.');
const dataDir = path.resolve(process.env.ENTITY_DATA_DIR || 'data');
const vault = createVault(dataDir);
const store = new Store(path.join(dataDir, 'entity.sqlite'));
const network = createNetwork();
const connectors = new Connectors(network);
const mail = createMail({ network });
const app = createApp({
  store,
  connectors,
  vault,
  mail,
  accessToken,
  publicOrigin: process.env.ENTITY_PUBLIC_ORIGIN,
  port,
});
const worker = new Worker(store, connectors, vault);
const server = app.listen(port, host, () => {
  console.log(`Entity Workspace đang chạy ở cổng ${port}.`);
  worker.start();
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const closed = new Promise((resolve) => server.close(resolve));
  await worker.stop();
  await closed;
  await network.close();
  store.close();
}
process.on('SIGINT', () => shutdown().then(() => process.exit(0)));
process.on('SIGTERM', () => shutdown().then(() => process.exit(0)));
