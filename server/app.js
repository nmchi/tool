import express from 'express';
import { z } from 'zod';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { AppError, hostKey, publicUrl, normalizedUrl, safeCsv, matchesPlatform } from './urls.js';
import { parseImport } from './catalog.js';
import { entitySchema } from './schema.js';
import { PROVIDERS, parseServiceAccount } from './mail.js';

const urlField = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => {
    try {
      publicUrl(v);
      return true;
    } catch {
      return false;
    }
  }, 'Cần URL công khai hợp lệ.');
const projectSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    website: urlField,
    username: z
      .string()
      .trim()
      .min(2)
      .max(60)
      .regex(/^[a-zA-Z0-9_.-]+$/, 'Username chỉ gồm chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.'),
    description: z.string().trim().max(2000).default(''),
    email: z.email('Cần email hợp lệ, riêng cho website này.'),
    logo_url: z.union([urlField, z.literal('')]).default(''),
    entity_type: z.enum(['organization', 'person']).default('organization'),
    monitoring: z.boolean().default(true),
    mailbox_id: z.string().nullable().default(null),
  })
  .strict();
const hostField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9.-]+.[a-z]{2,}$/, 'Máy chủ IMAP chỉ gồm tên miền, ví dụ imap.gmail.com.');
const mailboxSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    provider: z.enum(PROVIDERS),
    address: z.email(),
    imap_host: z.union([hostField, z.literal('')]).default(''),
    secret: z.string().max(20000).default(''),
  })
  .strict();
const importSchema = z.object({ text: z.string().min(1).max(400000) });
const parse = (schema, value) => {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError(
      result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  return result.data;
};

export function createApp({
  store,
  connectors,
  vault,
  mail,
  accessToken = '',
  publicOrigin = '',
  port = 4310,
  distDir = path.resolve('dist'),
}) {
  const app = express();
  app.disable('x-powered-by');
  const origins = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
    'http://127.0.0.1:5173',
    'http://localhost:5173',
  ]);
  if (publicOrigin) origins.add(new URL(publicOrigin).origin);
  const hosts = new Set([...origins].map((o) => new URL(o).host));
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    if (!hosts.has(req.headers.host))
      return res.status(403).json({ error: 'Host không được cấu hình.' });
    if (req.headers.origin && !origins.has(req.headers.origin))
      return res.status(403).json({ error: 'Origin không được phép.' });
    next();
  });
  app.get('/api/health', (_req, res) =>
    res.json({ ok: true, version: '0.1.0', requires_auth: !!accessToken }),
  );
  app.use('/api', (req, res, next) => {
    if (accessToken) {
      const actual = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
      const expected = Buffer.from(accessToken);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        return res.status(401).json({ error: 'Cần mã truy cập workspace.' });
    }
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-entity-client'] !== 'workspace')
      return res.status(403).json({ error: 'Thiếu header ứng dụng.' });
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.get('/api/state', (_req, res) => res.json(store.snapshot()));
  app.get('/api/reference-urls', (_req, res) => {
    const file = path.resolve('examples/reference-urls.txt');
    res.json({ text: existsSync(file) ? readFileSync(file, 'utf8') : '' });
  });
  app.post('/api/projects', (req, res) =>
    res.status(201).json(store.createProject(parse(projectSchema, req.body))),
  );
  app.put('/api/projects/:id', (req, res) =>
    res.json(store.updateProject(req.params.id, parse(projectSchema, req.body))),
  );
  // Validates the mailbox against its provider before anything is stored.
  const checkMailbox = async (input, id) => {
    if (input.provider === 'imap' && !input.imap_host)
      throw new AppError('Nhập máy chủ IMAP, ví dụ imap.gmail.com.');
    if (input.provider !== 'manual' && !input.secret)
      throw new AppError(
        input.provider === 'imap'
          ? 'Nhập App Password của hộp thư.'
          : 'Dán khóa JSON của service account.',
      );
    if (input.provider === 'gmail_api') parseServiceAccount(input.secret);
    const mailbox = { ...input, id, imap_host: input.provider === 'imap' ? input.imap_host : '' };
    await mail.client(mailbox, input.secret).test();
    return mailbox;
  };
  app.post('/api/mailboxes', async (req, res) => {
    const input = parse(mailboxSchema, req.body);
    const id = randomUUID();
    const mailbox = await checkMailbox(input, id);
    try {
      store.run(
        `INSERT INTO mailboxes(id,name,provider,address,imap_host,encrypted_secret,verified_at,created_at)
        VALUES (?,?,?,?,?,?,?,?)`,
        id,
        mailbox.name,
        mailbox.provider,
        mailbox.address.toLowerCase(),
        mailbox.imap_host,
        mailbox.secret ? vault.encrypt(mailbox.secret, id) : '',
        mailbox.provider === 'manual' ? null : Date.now(),
        Date.now(),
      );
    } catch (error) {
      if (String(error.message).includes('UNIQUE'))
        throw new AppError('Đã có hộp thư cùng tên.', 409);
      throw error;
    }
    store.event('mailbox_added', `Đã kết nối hộp thư ${mailbox.name}.`);
    const { encrypted_secret: _s, ...saved } = store.require('mailboxes', id);
    res.status(201).json(saved);
  });
  app.post('/api/mailboxes/:id/test', async (req, res) => {
    const input = parse(
      z.object({ to: z.union([z.email(), z.literal('')]).optional() }).strict(),
      req.body,
    );
    const mailbox = store.require('mailboxes', req.params.id);
    if (mailbox.provider === 'manual') return res.json({ ok: true, messages: [], manual: true });
    let secret;
    try {
      secret = vault.decrypt(mailbox.encrypted_secret, mailbox.id);
    } catch {
      throw new AppError('Không mở được bí mật của hộp thư. Hãy kết nối lại.', 409);
    }
    const client = mail.client(mailbox, secret);
    await client.test();
    store.run('UPDATE mailboxes SET verified_at=? WHERE id=?', Date.now(), mailbox.id);
    // Only metadata of a few recent messages is returned, to confirm alias routing.
    const messages = await client.search({
      to: input.to || undefined,
      since: Date.now() - 3 * 86400000,
      limit: 5,
    });
    res.json({
      ok: true,
      messages: messages.map(({ from, subject, date }) => ({ from, subject, date })),
    });
  });
  app.delete('/api/mailboxes/:id', (req, res) => {
    const mailbox = store.require('mailboxes', req.params.id);
    store.tx(() => {
      store.run('UPDATE projects SET mailbox_id=NULL WHERE mailbox_id=?', mailbox.id);
      store.run('DELETE FROM mailboxes WHERE id=?', mailbox.id);
    });
    store.event(
      'mailbox_removed',
      `Đã xóa hộp thư ${mailbox.name} khỏi workspace. Thu hồi App Password hoặc khóa service account nếu không dùng nữa.`,
    );
    res.json({ ok: true });
  });
  app.get('/api/projects/:id/schema', (req, res) => {
    const project = store.require('projects', req.params.id);
    const profiles = store.all(
      `SELECT f.url,f.status,t.name AS platform_name FROM profiles f JOIN platforms t ON t.id=f.platform_id
      WHERE f.project_id=? ORDER BY t.name`,
      project.id,
    );
    res.json(entitySchema(project, profiles));
  });
  app.post('/api/profiles', (req, res) => {
    const input = parse(
      z.object({ project_id: z.string(), platform_id: z.string(), url: urlField }).strict(),
      req.body,
    );
    if (
      store.get(
        "SELECT id FROM jobs WHERE project_id=? AND platform_id=? AND status='running'",
        input.project_id,
        input.platform_id,
      )
    )
      throw new AppError('Đợi tác vụ đang chạy hoàn tất trước khi đổi URL.', 409);
    const profile = store.putProfile(input.project_id, input.platform_id, input.url);
    store.event(
      'profile_added',
      'Đã lưu URL hồ sơ; chưa xác minh công khai.',
      null,
      input.project_id,
    );
    res.status(201).json(profile);
  });
  app.post('/api/batches', (req, res) => {
    const input = parse(
      z
        .object({
          name: z.string().trim().min(1).max(100),
          project_ids: z.array(z.string()).min(1).max(100),
          platform_ids: z.array(z.string()).min(1).max(500),
          kind: z.enum(['prepare', 'verify', 'sync']),
        })
        .strict(),
      req.body,
    );
    res.status(201).json(store.createBatch(input));
  });
  app.get('/api/profiles/:id/history', (req, res) => {
    store.require('profiles', req.params.id);
    res.json(
      store
        .all(
          'SELECT * FROM profile_checks WHERE profile_id=? ORDER BY id DESC LIMIT 100',
          req.params.id,
        )
        .map((c) => ({ ...c, evidence: JSON.parse(c.evidence) })),
    );
  });
  app.patch('/api/profiles/:id/checklist', (req, res) => {
    const input = parse(
      z
        .object({
          account_email: z.union([z.email(), z.literal('')]),
          email_verified: z.enum(['unknown', 'yes', 'no']),
          two_factor: z.enum(['unknown', 'enabled', 'disabled', 'unavailable']),
          owner_confirmed: z.boolean(),
        })
        .strict(),
      req.body,
    );
    const profile = store.require('profiles', req.params.id);
    store.run(
      'UPDATE profiles SET account_email=?,email_verified=?,two_factor=?,owner_confirmed=? WHERE id=?',
      input.account_email,
      input.email_verified,
      input.two_factor,
      Number(input.owner_confirmed),
      profile.id,
    );
    store.event(
      'checklist_updated',
      'Người quản lý đã cập nhật thông tin sở hữu, email và 2FA. Đây là khai báo thủ công.',
      null,
      profile.project_id,
    );
    res.json({ ok: true });
  });
  app.get('/api/jobs/:id/events', (req, res) => {
    store.require('jobs', req.params.id);
    res.json(
      store.all('SELECT * FROM events WHERE job_id=? ORDER BY id DESC LIMIT 100', req.params.id),
    );
  });
  app.post('/api/jobs/:id/action', (req, res) => {
    const input = parse(
      z
        .object({
          action: z.enum(['resume', 'cancel']),
          profile_url: z.union([urlField, z.literal('')]).optional(),
        })
        .strict(),
      req.body,
    );
    res.json(store.jobAction(req.params.id, input.action, input.profile_url));
  });
  app.post('/api/batches/:id/action', (req, res) => {
    const input = parse(
      z.object({ action: z.enum(['pause', 'resume', 'cancel']) }).strict(),
      req.body,
    );
    store.batchAction(req.params.id, input.action);
    res.json({ ok: true });
  });
  app.patch('/api/platforms/:id', (req, res) => {
    const input = parse(
      z
        .object({
          enabled: z.boolean().optional(),
          paused: z.boolean().optional(),
          interval_ms: z.number().int().min(10000).max(3600000).optional(),
          name: z.string().trim().min(1).max(100).optional(),
          registration_url: urlField.optional(),
          profile_template: z.string().max(2000).optional(),
        })
        .strict(),
      req.body,
    );
    const platform = store.require('platforms', req.params.id);
    if (input.registration_url && !matchesPlatform(input.registration_url, platform))
      throw new AppError('Trang đăng ký phải thuộc nền tảng.');
    if (
      input.profile_template &&
      !matchesPlatform(input.profile_template.replace('{username}', 'example'), platform)
    )
      throw new AppError('Mẫu URL phải thuộc nền tảng.');
    const fields = Object.keys(input);
    if (fields.length)
      store.run(
        `UPDATE platforms SET ${fields.map((k) => `${k}=?`).join(',')} WHERE id=?`,
        ...fields.map((k) => (typeof input[k] === 'boolean' ? Number(input[k]) : input[k])),
        platform.id,
      );
    store.event('platform_updated', `Đã cập nhật cấu hình nền tảng ${platform.name}.`);
    res.json(store.require('platforms', platform.id));
  });
  app.post('/api/import/preview', (req, res) => {
    const input = parse(importSchema, req.body);
    try {
      res.json(parseImport(input.text));
    } catch (error) {
      throw new AppError(error.message);
    }
  });
  const importPlatform = (row) => {
    const existing = store.get('SELECT * FROM platforms WHERE host_key=?', row.host);
    if (existing) return existing;
    const id = randomUUID();
    store.run(
      `INSERT INTO platforms(id,name,origin,host_key,connector,category,registration_url,enabled,samples,created_at)
      VALUES (?,?,?,?,'manual','other',?,0,?,?)`,
      id,
      row.host,
      row.origin,
      row.host,
      row.origin,
      JSON.stringify([row.url]),
      Date.now(),
    );
    return store.require('platforms', id);
  };
  app.post('/api/import/commit', (req, res) => {
    const input = parse(
      z
        .object({
          text: z.string().min(1).max(400000),
          mode: z.enum(['catalog', 'profiles']),
          project_id: z.string().optional(),
          include_unknown: z.boolean().default(false),
        })
        .strict(),
      req.body,
    );
    let preview;
    try {
      preview = parseImport(input.text);
    } catch (error) {
      throw new AppError(error.message);
    }
    if (input.mode === 'profiles') {
      if (!input.project_id) throw new AppError('Chọn dự án sở hữu các hồ sơ này.');
      store.require('projects', input.project_id);
      if (
        store.get("SELECT id FROM jobs WHERE project_id=? AND status='running'", input.project_id)
      )
        throw new AppError('Đợi tác vụ của dự án hoàn tất trước khi nhập hồ sơ.', 409);
    }
    const result = store.tx(() => {
      let created = 0,
        skipped = preview.duplicates;
      const pairs = new Set();
      for (const row of preview.rows) {
        if (
          !row.url ||
          ['invalid', 'report', 'redirect', 'content'].includes(row.kind) ||
          (row.kind === 'unknown' && !input.include_unknown)
        ) {
          skipped++;
          continue;
        }
        const existing = store.get('SELECT id FROM platforms WHERE host_key=?', row.host);
        const platform = importPlatform(row);
        if (input.mode === 'catalog') {
          if (!existing) created++;
          else skipped++;
        } else {
          // Never silently replace two different profiles for the same pair.
          if (
            pairs.has(platform.id) ||
            store.get(
              'SELECT id FROM profiles WHERE project_id=? AND platform_id=?',
              input.project_id,
              platform.id,
            )
          ) {
            skipped++;
            continue;
          }
          pairs.add(platform.id);
          store.putProfile(input.project_id, platform.id, row.url);
          created++;
        }
      }
      store.event(
        'imported',
        `Đã nhập ${created} ${input.mode === 'catalog' ? 'nền tảng' : 'hồ sơ'}; bỏ qua ${skipped}. Nền tảng mới cần được xem xét và bật.`,
        null,
        input.project_id,
      );
      return { created, skipped };
    });
    res.json(result);
  });
  app.post('/api/accounts', async (req, res) => {
    const input = parse(
      z
        .object({
          project_id: z.string(),
          platform_id: z.string(),
          token: z.string().trim().min(10).max(4096),
        })
        .strict(),
      req.body,
    );
    store.require('projects', input.project_id);
    const platform = store.require('platforms', input.platform_id);
    const identity = await connectors.identity(platform, input.token);
    const result = store.tx(() => {
      if (
        store.get(
          "SELECT id FROM jobs WHERE project_id=? AND platform_id=? AND status='running'",
          input.project_id,
          input.platform_id,
        )
      )
        throw new AppError('Đợi tác vụ đang chạy trước khi đổi tài khoản.', 409);
      const other = store.get(
        'SELECT id FROM accounts WHERE platform_id=? AND remote_id=? AND project_id<>?',
        platform.id,
        identity.remote_id,
        input.project_id,
      );
      if (other)
        throw new AppError(
          'Tài khoản này đang thuộc dự án khác. Ngắt kết nối ở dự án cũ trước khi chuyển.',
          409,
        );
      const current = store.get(
        'SELECT id FROM accounts WHERE project_id=? AND platform_id=?',
        input.project_id,
        platform.id,
      );
      const id = current?.id ?? randomUUID();
      store.run(
        `INSERT INTO accounts(id,project_id,platform_id,remote_id,username,profile_url,encrypted_token,verified_at) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(project_id,platform_id) DO UPDATE SET remote_id=excluded.remote_id,username=excluded.username,profile_url=excluded.profile_url,encrypted_token=excluded.encrypted_token,verified_at=excluded.verified_at`,
        id,
        input.project_id,
        platform.id,
        identity.remote_id,
        identity.username,
        normalizedUrl(identity.profile_url),
        vault.encrypt(input.token, id),
        Date.now(),
      );
      store.putProfile(input.project_id, platform.id, identity.profile_url);
      store.event(
        'account_connected',
        `Đã xác minh tài khoản ${identity.username} trên ${platform.name}.`,
        null,
        input.project_id,
      );
      return { id, username: identity.username, profile_url: identity.profile_url };
    });
    res.status(201).json(result);
  });
  app.delete('/api/accounts/:id', (req, res) => {
    const account = store.get('SELECT * FROM accounts WHERE id=?', req.params.id);
    if (!account) throw new AppError('Không tìm thấy tài khoản.', 404);
    if (
      store.get(
        "SELECT id FROM jobs WHERE project_id=? AND platform_id=? AND status='running'",
        account.project_id,
        account.platform_id,
      )
    )
      throw new AppError('Đợi tác vụ đang chạy trước khi ngắt kết nối.', 409);
    store.run('DELETE FROM accounts WHERE id=?', account.id);
    store.event(
      'account_disconnected',
      'Đã xóa token khỏi workspace. Thu hồi token trên nền tảng nếu không dùng nữa.',
      null,
      account.project_id,
    );
    res.json({ ok: true });
  });
  app.get('/api/export/profiles.csv', (_req, res) => {
    const profiles = store.snapshot().profiles;
    const rows = [
      [
        'project',
        'platform',
        'url',
        'status',
        'brand_match',
        'backlink',
        'last_checked',
        'next_check',
        'reason',
      ],
      ...profiles.map((p) => [
        p.project_name,
        p.platform_name,
        p.url,
        p.status,
        p.identity_match,
        p.backlink,
        p.last_checked ? new Date(p.last_checked).toISOString() : '',
        p.next_check ? new Date(p.next_check).toISOString() : '',
        p.evidence?.reason ?? '',
      ]),
    ];
    res
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="entity-profiles.csv"',
      })
      .send(safeCsv(rows));
  });
  app.get('/api/export/jobs.csv', (_req, res) => {
    const rows = store.all(
      `SELECT j.*,p.name AS project_name,t.name AS platform_name FROM jobs j JOIN projects p ON p.id=j.project_id JOIN platforms t ON t.id=j.platform_id ORDER BY j.created_at DESC`,
    );
    res
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="entity-jobs.csv"',
      })
      .send(
        safeCsv([
          ['id', 'project', 'platform', 'kind', 'status', 'attempts', 'reason', 'created_at'],
          ...rows.map((j) => [
            j.id,
            j.project_name,
            j.platform_name,
            j.kind,
            j.status,
            j.attempts,
            j.reason,
            new Date(j.created_at).toISOString(),
          ]),
        ]),
      );
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API không tồn tại.' }));
  if (existsSync(distDir)) {
    app.use(express.static(distDir, { index: false }));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
  } else
    app.get('/{*path}', (_req, res) =>
      res
        .status(503)
        .send('Chạy pnpm run build trước khi mở ứng dụng, hoặc pnpm run dev để phát triển.'),
    );
  app.use((error, _req, res, _next) => {
    if (error instanceof AppError)
      return res.status(error.status).json({ error: error.message, code: error.code });
    if (error.type === 'entity.too.large')
      return res.status(413).json({ error: 'Dữ liệu vượt giới hạn 1 MB.' });
    if (error instanceof SyntaxError && 'body' in error)
      return res.status(400).json({ error: 'JSON không hợp lệ.' });
    // Never echo request bodies, tokens, SQL or remote response bodies.
    console.error('Yêu cầu thất bại do lỗi nội bộ.');
    res.status(500).json({ error: 'Lỗi xử lý nội bộ. Dữ liệu chưa được xác nhận thay đổi.' });
  });
  return app;
}
