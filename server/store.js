import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { SEEDS } from './catalog.js';
import { AppError, websiteKey, normalizedUrl, matchesPlatform, emailKey, isGmail } from './urls.js';

export const ACTIVE = ['queued', 'running', 'retry', 'action_required'];

export class Store {
  constructor(filename = ':memory:') {
    if (filename !== ':memory:')
      mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    if (filename !== ':memory:') chmodSync(filename, 0o600);
    if (this.get('PRAGMA user_version').user_version > 3)
      throw new Error('Database dùng phiên bản mới hơn ứng dụng này.');
    this.db.exec(`
      PRAGMA foreign_keys=ON;
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, website TEXT NOT NULL, website_key TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
        logo_url TEXT NOT NULL DEFAULT '', entity_type TEXT NOT NULL DEFAULT 'organization',
        monitoring INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS platforms (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, origin TEXT NOT NULL, host_key TEXT NOT NULL UNIQUE,
        connector TEXT NOT NULL DEFAULT 'manual', category TEXT NOT NULL DEFAULT 'other',
        registration_url TEXT NOT NULL, profile_template TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1, paused INTEGER NOT NULL DEFAULT 0,
        interval_ms INTEGER NOT NULL DEFAULT 10000, samples TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        platform_id TEXT NOT NULL REFERENCES platforms(id), remote_id TEXT NOT NULL,
        username TEXT NOT NULL, profile_url TEXT NOT NULL, encrypted_token TEXT NOT NULL,
        verified_at INTEGER NOT NULL, UNIQUE(project_id, platform_id), UNIQUE(platform_id, remote_id)
      );
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        platform_id TEXT NOT NULL REFERENCES platforms(id), url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unverified', backlink INTEGER, identity_match INTEGER,
        last_checked INTEGER, first_verified INTEGER, next_check INTEGER,
        evidence TEXT, created_at INTEGER NOT NULL, UNIQUE(project_id, platform_id)
      );
      CREATE TABLE IF NOT EXISTS batches (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES batches(id),
        project_id TEXT NOT NULL REFERENCES projects(id), platform_id TEXT NOT NULL REFERENCES platforms(id),
        kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', step TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
        available_at INTEGER NOT NULL, lease_until INTEGER, worker_id TEXT,
        project_version INTEGER NOT NULL, reason TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS job_active_pair_kind ON jobs(project_id,platform_id,kind)
        WHERE status IN ('queued','running','retry','action_required');
      CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(status,available_at);
      CREATE TABLE IF NOT EXISTS rate_limits (origin TEXT PRIMARY KEY, next_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS profile_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT NOT NULL REFERENCES profiles(id),
        job_id TEXT NOT NULL REFERENCES jobs(id), status TEXT NOT NULL, evidence TEXT NOT NULL,
        project_version INTEGER NOT NULL, checked_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS profile_checks_recent ON profile_checks(profile_id,checked_at DESC);
      CREATE TABLE IF NOT EXISTS mailboxes (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, provider TEXT NOT NULL,
        address TEXT NOT NULL, imap_host TEXT NOT NULL DEFAULT '',
        encrypted_secret TEXT NOT NULL DEFAULT '', verified_at INTEGER, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, project_id TEXT, type TEXT NOT NULL,
        message TEXT NOT NULL, created_at INTEGER NOT NULL
      );
    `);
    const columns = new Set(this.all('PRAGMA table_info(profiles)').map((c) => c.name));
    for (const [name, type] of Object.entries({
      account_email: "TEXT NOT NULL DEFAULT ''",
      email_verified: "TEXT NOT NULL DEFAULT 'unknown'",
      two_factor: "TEXT NOT NULL DEFAULT 'unknown'",
      owner_confirmed: 'INTEGER NOT NULL DEFAULT 0',
    })) {
      if (!columns.has(name)) this.db.exec(`ALTER TABLE profiles ADD COLUMN ${name} ${type}`);
    }
    const projectColumns = new Set(this.all('PRAGMA table_info(projects)').map((c) => c.name));
    if (!projectColumns.has('mailbox_id'))
      this.db.exec('ALTER TABLE projects ADD COLUMN mailbox_id TEXT REFERENCES mailboxes(id)');
    this.db.exec('PRAGMA user_version=3');
    for (const p of SEEDS)
      this.run(
        `INSERT OR IGNORE INTO platforms
      (id,name,origin,host_key,connector,category,registration_url,profile_template,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
        p.id,
        p.name,
        p.origin,
        new URL(p.origin).hostname.replace(/^www\./, ''),
        p.connector,
        p.category,
        p.registration_url,
        p.profile_template,
        Date.now(),
      );
  }

  run(sql, ...args) {
    return this.db.prepare(sql).run(...args);
  }
  get(sql, ...args) {
    return this.db.prepare(sql).get(...args);
  }
  all(sql, ...args) {
    return this.db.prepare(sql).all(...args);
  }
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  event(type, message, job = null, projectId = null) {
    this.run(
      'INSERT INTO events(job_id,project_id,type,message,created_at) VALUES (?,?,?,?,?)',
      job?.id ?? null,
      projectId ?? job?.project_id ?? null,
      type,
      message,
      Date.now(),
    );
  }
  require(table, id) {
    if (!['projects', 'platforms', 'jobs', 'profiles', 'batches', 'mailboxes'].includes(table))
      throw new Error('Invalid table');
    const row = this.get(`SELECT * FROM ${table} WHERE id=?`, id);
    if (!row) throw new AppError('Không tìm thấy dữ liệu.', 404);
    return row;
  }
  mailboxRef(id) {
    if (!id) return null;
    return this.require('mailboxes', id).id;
  }
  // Every website owns one email, shared by all of its entity profiles; no two websites
  // may use the same inbox (aliases such as +tags or Gmail dots count as the same).
  checkEmail(input, projectId = null) {
    const key = emailKey(input.email);
    if (!key) throw new AppError('Cần email riêng cho website này.');
    const clash = this.all('SELECT id,name,email FROM projects WHERE id IS NOT ?', projectId).find(
      (p) => emailKey(p.email) === key,
    );
    if (clash)
      throw new AppError(
        `Email này đã dùng cho dự án ${clash.name}. Mỗi website cần email riêng.`,
        409,
      );
    if (input.mailbox_id) {
      const mailbox = this.require('mailboxes', input.mailbox_id);
      if (isGmail(mailbox.address) && emailKey(mailbox.address) !== key)
        throw new AppError(
          `Hộp thư Gmail ${mailbox.address} chỉ nhận thư của chính nó. Đặt email dự án là ${mailbox.address} hoặc chọn hộp thư khác.`,
        );
    }
  }
  createProject(input) {
    const id = randomUUID(),
      now = Date.now();
    this.checkEmail(input);
    try {
      this.run(
        `INSERT INTO projects(id,name,website,website_key,username,description,email,logo_url,entity_type,monitoring,mailbox_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id,
        input.name,
        normalizedUrl(input.website),
        websiteKey(input.website),
        input.username,
        input.description,
        input.email,
        input.logo_url,
        input.entity_type,
        Number(input.monitoring),
        this.mailboxRef(input.mailbox_id),
        now,
        now,
      );
    } catch (error) {
      if (String(error.message).includes('UNIQUE'))
        throw new AppError('Website này đã có dự án.', 409);
      throw error;
    }
    this.event('project_created', `Đã tạo dự án ${input.name}.`, null, id);
    return this.require('projects', id);
  }
  updateProject(id, input) {
    this.require('projects', id);
    return this.tx(() => {
      if (this.get("SELECT id FROM jobs WHERE project_id=? AND status='running'", id))
        throw new AppError('Đợi tác vụ đang chạy hoàn tất trước khi đổi thông tin.', 409);
      this.checkEmail(input, id);
      try {
        this.run(
          `UPDATE projects SET name=?,website=?,website_key=?,username=?,description=?,email=?,logo_url=?,entity_type=?,monitoring=?,mailbox_id=?,version=version+1,updated_at=? WHERE id=?`,
          input.name,
          normalizedUrl(input.website),
          websiteKey(input.website),
          input.username,
          input.description,
          input.email,
          input.logo_url,
          input.entity_type,
          Number(input.monitoring),
          this.mailboxRef(input.mailbox_id),
          Date.now(),
          id,
        );
      } catch (error) {
        if (String(error.message).includes('UNIQUE'))
          throw new AppError('Website này đã có dự án.', 409);
        throw error;
      }
      // Evidence refers to an older identity until checked again.
      this.run(
        "UPDATE profiles SET status='unverified',backlink=NULL,identity_match=NULL,next_check=? WHERE project_id=?",
        Date.now(),
        id,
      );
      this.event('project_updated', 'Đã cập nhật thông tin; các hồ sơ cần kiểm tra lại.', null, id);
      return this.require('projects', id);
    });
  }
  putProfile(projectId, platformId, url) {
    this.require('projects', projectId);
    const platform = this.require('platforms', platformId);
    const normalized = normalizedUrl(url);
    if (!matchesPlatform(normalized, platform))
      throw new AppError('URL hồ sơ phải thuộc đúng nền tảng đã chọn.');
    const account = this.get(
      'SELECT profile_url FROM accounts WHERE project_id=? AND platform_id=?',
      projectId,
      platformId,
    );
    if (account && normalizedUrl(account.profile_url) !== normalized)
      throw new AppError(
        'URL không khớp tài khoản API đang kết nối. Kết nối lại đúng tài khoản trước khi đổi URL.',
        409,
      );
    const existing = this.get(
      'SELECT * FROM profiles WHERE project_id=? AND platform_id=?',
      projectId,
      platformId,
    );
    if (existing?.url === normalized) return existing;
    this.run(
      `INSERT INTO profiles(id,project_id,platform_id,url,created_at) VALUES (?,?,?,?,?)
      ON CONFLICT(project_id,platform_id) DO UPDATE SET url=excluded.url,status='unverified',last_checked=NULL,
      first_verified=NULL,next_check=NULL,backlink=NULL,identity_match=NULL,evidence=NULL,
      account_email='',email_verified='unknown',two_factor='unknown',owner_confirmed=0`,
      randomUUID(),
      projectId,
      platformId,
      normalized,
      Date.now(),
    );
    return this.get(
      'SELECT * FROM profiles WHERE project_id=? AND platform_id=?',
      projectId,
      platformId,
    );
  }

  createBatch({ name, project_ids, platform_ids, kind }) {
    return this.tx(() => {
      const projects = [...new Set(project_ids)].map((id) => this.require('projects', id));
      const platforms = [...new Set(platform_ids)].map((id) => this.require('platforms', id));
      if (projects.length * platforms.length > 500)
        throw new AppError('Mỗi lô tối đa 500 cặp dự án–nền tảng.');
      const id = randomUUID(),
        now = Date.now();
      this.run('INSERT INTO batches(id,name,created_at) VALUES (?,?,?)', id, name, now);
      let created = 0,
        skipped = 0;
      for (const project of projects)
        for (const platform of platforms) {
          if (
            !platform.enabled ||
            (kind === 'sync' && platform.connector === 'manual') ||
            this.get(
              `SELECT id FROM jobs WHERE project_id=? AND platform_id=? AND kind=?
          AND status IN ('queued','running','retry','action_required')`,
              project.id,
              platform.id,
              kind,
            )
          ) {
            skipped++;
            continue;
          }
          const jobId = randomUUID();
          this.run(
            `INSERT INTO jobs(id,batch_id,project_id,platform_id,kind,available_at,project_version,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?)`,
            jobId,
            id,
            project.id,
            platform.id,
            kind,
            now,
            project.version,
            now,
            now,
          );
          created++;
        }
      this.event(
        'batch_created',
        `Lô “${name}”: ${created} tác vụ, ${skipped} cặp bỏ qua do trùng hoặc nền tảng chưa bật.`,
      );
      return { id, created, skipped };
    });
  }

  recover(now = Date.now()) {
    const jobs = this.all("SELECT * FROM jobs WHERE status='running' AND lease_until<=?", now);
    for (const job of jobs) {
      const state = job.attempts < job.max_attempts ? 'retry' : 'failed';
      this.run(
        `UPDATE jobs SET status=?,step='recovered',worker_id=NULL,lease_until=NULL,available_at=?,updated_at=?,reason=?
        WHERE id=? AND status='running' AND lease_until<=?`,
        state,
        now,
        now,
        'Tác vụ mất kết nối; sẽ đối chiếu trạng thái trước khi tiếp tục.',
        job.id,
        now,
      );
      this.event('recovered', 'Đã phục hồi tác vụ hết thời hạn xử lý.', job);
      if (state === 'failed') {
        this.run(
          "UPDATE profiles SET status='unknown',next_check=? WHERE project_id=? AND platform_id=?",
          now + 86400000,
          job.project_id,
          job.platform_id,
        );
      }
    }
  }

  claim(workerId, concurrency = 2, now = Date.now()) {
    return this.tx(() => {
      this.recover(now);
      const active = this.get("SELECT count(*) AS n FROM jobs WHERE status='running'").n;
      if (active >= concurrency) return null;
      const job = this.get(
        `SELECT j.* FROM jobs j JOIN batches b ON b.id=j.batch_id JOIN platforms p ON p.id=j.platform_id
        LEFT JOIN rate_limits r ON r.origin=p.origin
        WHERE j.status IN ('queued','retry') AND j.available_at<=? AND b.status='active' AND p.paused=0 AND p.enabled=1
        AND COALESCE(r.next_at,0)<=? AND NOT EXISTS (
          SELECT 1 FROM jobs other WHERE other.project_id=j.project_id AND other.platform_id=j.platform_id AND other.status='running'
        ) ORDER BY j.available_at,j.created_at LIMIT 1`,
        now,
        now,
      );
      if (!job) return null;
      const platform = this.require('platforms', job.platform_id);
      this.run(
        `INSERT INTO rate_limits(origin,next_at) VALUES (?,?) ON CONFLICT(origin) DO UPDATE SET next_at=excluded.next_at`,
        platform.origin,
        now + platform.interval_ms,
      );
      this.run(
        "UPDATE jobs SET status='running',step='preflight',attempts=attempts+1,worker_id=?,lease_until=?,updated_at=? WHERE id=?",
        workerId,
        now + 90000,
        now,
        job.id,
      );
      this.event('running', `Bắt đầu lần ${job.attempts + 1}.`, job);
      return this.require('jobs', job.id);
    });
  }

  finish(job, { status, reason = '', step = status, delay = 0 }) {
    const current = this.require('jobs', job.id);
    if (current.worker_id !== job.worker_id || current.status !== 'running') return false;
    this.run(
      `UPDATE jobs SET status=?,reason=?,step=?,available_at=?,lease_until=NULL,worker_id=NULL,updated_at=? WHERE id=? AND worker_id=?`,
      status,
      reason,
      step,
      Date.now() + delay,
      Date.now(),
      job.id,
      job.worker_id,
    );
    this.event(status, reason || 'Đã hoàn tất.', job);
    return true;
  }

  jobAction(id, action, profileUrl) {
    return this.tx(() => {
      const job = this.require('jobs', id);
      if (job.status === 'running') throw new AppError('Tác vụ đang xử lý; hãy đợi hoàn tất.', 409);
      const batch = this.require('batches', job.batch_id);
      if (batch.status === 'cancelled')
        throw new AppError('Lô đã hủy. Hãy tạo lô mới để tiếp tục.', 409);
      if (action === 'cancel') {
        if (!ACTIVE.includes(job.status)) throw new AppError('Tác vụ đã kết thúc.', 409);
        this.run("UPDATE jobs SET status='cancelled',updated_at=? WHERE id=?", Date.now(), id);
      } else {
        if (!['action_required', 'failed'].includes(job.status))
          throw new AppError('Chỉ tiếp tục tác vụ đang chờ xử lý hoặc đã lỗi.', 409);
        if (
          this.get(
            `SELECT id FROM jobs WHERE id<>? AND project_id=? AND platform_id=? AND kind=? AND status IN ('queued','running','retry','action_required')`,
            id,
            job.project_id,
            job.platform_id,
            job.kind,
          )
        )
          throw new AppError('Đã có tác vụ khác cho cặp này.', 409);
        if (profileUrl) this.putProfile(job.project_id, job.platform_id, profileUrl);
        this.run(
          `UPDATE jobs SET status='queued',step='queued',reason='',attempts=0,available_at=?,project_version=?,updated_at=? WHERE id=?`,
          Date.now(),
          this.require('projects', job.project_id).version,
          Date.now(),
          id,
        );
      }
      this.event(
        action === 'cancel' ? 'cancelled' : 'resumed',
        action === 'cancel' ? 'Đã hủy tác vụ.' : 'Đã đưa tác vụ về hàng đợi.',
        job,
      );
      return this.require('jobs', id);
    });
  }

  batchAction(id, action) {
    return this.tx(() => {
      const batch = this.require('batches', id);
      if (batch.status === 'cancelled') throw new AppError('Lô đã hủy.', 409);
      const status = { pause: 'paused', resume: 'active', cancel: 'cancelled' }[action];
      this.run('UPDATE batches SET status=? WHERE id=?', status, id);
      if (action === 'cancel')
        this.run(
          "UPDATE jobs SET status='cancelled',updated_at=? WHERE batch_id=? AND status IN ('queued','retry','action_required')",
          Date.now(),
          id,
        );
      this.event(
        `batch_${action}`,
        `Lô “${batch.name}”: ${status}. Tác vụ đang chạy được phép hoàn tất.`,
      );
    });
  }

  schedule(now = Date.now()) {
    const due = this.all(
      `SELECT f.* FROM profiles f JOIN projects p ON p.id=f.project_id
      JOIN platforms t ON t.id=f.platform_id WHERE p.monitoring=1 AND t.enabled=1 AND t.paused=0 AND f.next_check<=?`,
      now,
    );
    const candidates = due.filter(
      (f) =>
        !this.get(
          `SELECT id FROM jobs WHERE project_id=? AND platform_id=? AND status IN ('queued','running','retry','action_required')`,
          f.project_id,
          f.platform_id,
        ),
    );
    if (!candidates.length) return;
    this.tx(() => {
      const id = randomUUID();
      this.run(
        'INSERT INTO batches(id,name,created_at) VALUES (?,?,?)',
        id,
        'Kiểm tra định kỳ',
        now,
      );
      for (const f of candidates)
        this.run(
          `INSERT OR IGNORE INTO jobs(id,batch_id,project_id,platform_id,kind,available_at,project_version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`,
          randomUUID(),
          id,
          f.project_id,
          f.platform_id,
          'verify',
          now,
          this.require('projects', f.project_id).version,
          now,
          now,
        );
    });
  }

  snapshot() {
    return {
      projects: this
        .all(`SELECT p.*, (SELECT count(*) FROM profiles WHERE project_id=p.id) AS profile_count,
        (SELECT count(*) FROM profiles WHERE project_id=p.id AND status='healthy') AS healthy_count FROM projects p ORDER BY created_at DESC`),
      platforms: this.all('SELECT * FROM platforms ORDER BY enabled DESC,name').map((p) => ({
        ...p,
        samples: JSON.parse(p.samples),
      })),
      mailboxes: this.all(
        'SELECT id,name,provider,address,imap_host,verified_at,created_at FROM mailboxes ORDER BY name',
      ),
      accounts: this.all(
        'SELECT id,project_id,platform_id,remote_id,username,profile_url,verified_at FROM accounts',
      ),
      profiles: this.all(
        `SELECT f.*, p.name AS project_name,t.name AS platform_name FROM profiles f JOIN projects p ON p.id=f.project_id
        JOIN platforms t ON t.id=f.platform_id ORDER BY f.created_at DESC`,
      ).map((p) => ({ ...p, evidence: p.evidence ? JSON.parse(p.evidence) : null })),
      jobs: this
        .all(`SELECT j.*,p.name AS project_name,t.name AS platform_name,t.connector,t.registration_url,b.name AS batch_name,b.status AS batch_status
        FROM jobs j JOIN projects p ON p.id=j.project_id JOIN platforms t ON t.id=j.platform_id JOIN batches b ON b.id=j.batch_id ORDER BY j.created_at DESC LIMIT 2000`),
      batches: this
        .all(`SELECT b.*,count(j.id) AS total,sum(j.status='succeeded') AS succeeded,sum(j.status='action_required') AS waiting,
        sum(j.status IN ('queued','retry','running')) AS pending,sum(j.status='failed') AS failed FROM batches b LEFT JOIN jobs j ON j.batch_id=b.id GROUP BY b.id ORDER BY b.created_at DESC LIMIT 100`),
      events: this.all('SELECT * FROM events ORDER BY id DESC LIMIT 100'),
      stats: {
        projects: this.get('SELECT count(*) AS n FROM projects').n,
        profiles: this.get('SELECT count(*) AS n FROM profiles').n,
        healthy: this.get("SELECT count(*) AS n FROM profiles WHERE status='healthy'").n,
        waiting: this.get("SELECT count(*) AS n FROM jobs WHERE status='action_required'").n,
        pending: this.get(
          "SELECT count(*) AS n FROM jobs WHERE status IN ('queued','retry','running')",
        ).n,
        total_jobs: this.get('SELECT count(*) AS n FROM jobs').n,
      },
    };
  }
  close() {
    this.db.close();
  }
}
