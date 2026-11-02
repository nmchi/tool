import { randomUUID } from 'node:crypto';
import { AppError } from './urls.js';

const DAY = 86400000;
export function nextCheck(firstVerified, now) {
  if (!firstVerified) return now + DAY;
  for (const days of [1, 7, 30])
    if (firstVerified + days * DAY > now + 1000) return firstVerified + days * DAY;
  return now + 30 * DAY;
}

export class Worker {
  constructor(store, connectors, vault, { concurrency = 2, tickMs = 500 } = {}) {
    this.store = store;
    this.connectors = connectors;
    this.vault = vault;
    this.concurrency = concurrency;
    this.tickMs = tickMs;
    this.id = randomUUID();
    this.inFlight = new Set();
    this.lastSchedule = 0;
  }
  start() {
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.timer.unref();
    this.tick();
  }
  tick() {
    if (this.stopping) return;
    try {
      if (Date.now() - this.lastSchedule > 30000) {
        this.store.schedule();
        this.lastSchedule = Date.now();
      }
      while (this.inFlight.size < this.concurrency) {
        const job = this.store.claim(this.id, this.concurrency);
        if (!job) break;
        const promise = this.process(job)
          .catch(() => {
            console.error('Tác vụ chưa lưu được kết quả. Lease sẽ được phục hồi khi hết hạn.');
          })
          .finally(() => this.inFlight.delete(promise));
        this.inFlight.add(promise);
      }
    } catch {
      // Keep the timer alive; expose the issue without logging database contents.
      console.error('Worker chưa đọc được hàng đợi. Kiểm tra quyền và tình trạng SQLite.');
    }
  }
  async process(job) {
    const store = this.store;
    const heartbeat = setInterval(
      () =>
        store.run(
          "UPDATE jobs SET lease_until=? WHERE id=? AND worker_id=? AND status='running'",
          Date.now() + 90000,
          job.id,
          this.id,
        ),
      20000,
    );
    heartbeat.unref();
    try {
      const project = store.require('projects', job.project_id);
      const platform = store.require('platforms', job.platform_id);
      if (project.version !== job.project_version)
        return store.finish(job, {
          status: 'action_required',
          reason:
            'Thông tin dự án đã đổi. Kiểm tra dữ liệu rồi bấm tiếp tục để dùng phiên bản mới.',
        });
      let profile = store.get(
        'SELECT * FROM profiles WHERE project_id=? AND platform_id=?',
        project.id,
        platform.id,
      );
      if (job.kind === 'sync') {
        if (platform.connector === 'manual')
          return store.finish(job, {
            status: 'action_required',
            reason:
              'Nền tảng này chưa có API cập nhật. Hoàn thiện hồ sơ trên nền tảng và cung cấp URL để kiểm tra.',
          });
        const account = store.get(
          'SELECT * FROM accounts WHERE project_id=? AND platform_id=?',
          project.id,
          platform.id,
        );
        if (!account)
          return store.finish(job, {
            status: 'action_required',
            reason: 'Kết nối tài khoản API của dự án trước khi cập nhật hồ sơ.',
          });
        let token;
        try {
          token = this.vault.decrypt(account.encrypted_token, account.id);
        } catch {
          return store.finish(job, {
            status: 'action_required',
            reason: 'Không mở được kho tài khoản. Kiểm tra khóa mã hóa hoặc kết nối lại tài khoản.',
          });
        }
        store.run("UPDATE jobs SET step='syncing' WHERE id=?", job.id);
        const result = await this.connectors.sync(project, platform, account, token);
        store.run(
          'UPDATE accounts SET profile_url=?,username=? WHERE id=?',
          result.url,
          result.username,
          account.id,
        );
        profile = store.putProfile(project.id, platform.id, result.url);
        store.event(
          'profile_synced',
          result.changed
            ? 'Đã cập nhật thông tin qua API; tiếp tục kiểm tra công khai.'
            : 'Thông tin API đã khớp; tiếp tục kiểm tra công khai.',
          job,
        );
      }
      if (!profile)
        return store.finish(job, {
          status: 'action_required',
          reason:
            job.kind === 'verify'
              ? 'Chưa có URL hồ sơ để kiểm tra.'
              : 'Mở nền tảng, đăng ký/hoàn thiện hồ sơ bằng bộ thông tin dự án. Xử lý email, CAPTCHA hoặc 2FA nếu có rồi nhập URL hồ sơ.',
        });
      store.run("UPDATE jobs SET step='verifying' WHERE id=?", job.id);
      const result = await this.connectors.verify(project, platform, profile.url);
      const now = Date.now();
      const first = profile.first_verified ?? (result.status === 'healthy' ? now : null);
      store.run(
        `UPDATE profiles SET status=?,identity_match=?,backlink=?,last_checked=?,first_verified=?,next_check=?,evidence=? WHERE id=?`,
        result.status,
        result.identity_match == null ? null : Number(result.identity_match),
        result.backlink == null ? null : Number(result.backlink),
        now,
        first,
        nextCheck(first, now),
        JSON.stringify(result),
        profile.id,
      );
      store.run(
        'INSERT INTO profile_checks(profile_id,job_id,status,evidence,project_version,checked_at) VALUES (?,?,?,?,?,?)',
        profile.id,
        job.id,
        result.status,
        JSON.stringify(result),
        project.version,
        now,
      );
      store.finish(job, {
        status: result.status === 'healthy' ? 'succeeded' : 'action_required',
        reason: result.reason,
      });
    } catch (error) {
      const retryable = error.retryable || (error instanceof AppError && error.code === 'network');
      const reason =
        error instanceof AppError
          ? error.message
          : 'Lỗi xử lý nội bộ; xem lại bộ tích hợp trước khi tiếp tục.';
      const delay = Math.max(error.delay || 0, 10000 * 2 ** (job.attempts - 1));
      if (retryable) {
        const platform = store.require('platforms', job.platform_id);
        store.run(
          `INSERT INTO rate_limits(origin,next_at) VALUES (?,?) ON CONFLICT(origin) DO UPDATE SET next_at=max(next_at,excluded.next_at)`,
          platform.origin,
          Date.now() + delay,
        );
      }
      if (retryable && job.attempts < job.max_attempts) {
        store.finish(job, { status: 'retry', reason, delay });
      } else {
        if (retryable) {
          const profile = store.get(
            'SELECT id,url FROM profiles WHERE project_id=? AND platform_id=?',
            job.project_id,
            job.platform_id,
          );
          const now = Date.now();
          const evidence = JSON.stringify({
            status: 'unknown',
            reason,
            checked_at: now,
            url: profile?.url,
          });
          store.run(
            `UPDATE profiles SET status='unknown',identity_match=NULL,backlink=NULL,last_checked=?,next_check=?,evidence=? WHERE project_id=? AND platform_id=?`,
            now,
            now + DAY,
            evidence,
            job.project_id,
            job.platform_id,
          );
          if (profile)
            store.run(
              'INSERT INTO profile_checks(profile_id,job_id,status,evidence,project_version,checked_at) VALUES (?,?,?,?,?,?)',
              profile.id,
              job.id,
              'unknown',
              evidence,
              job.project_version,
              now,
            );
        }
        store.finish(job, { status: error.action ? 'action_required' : 'failed', reason });
      }
    } finally {
      clearInterval(heartbeat);
    }
  }
  async stop() {
    this.stopping = true;
    clearInterval(this.timer);
    await Promise.allSettled([...this.inFlight]);
  }
}
