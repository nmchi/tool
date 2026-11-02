import { useEffect, useState } from 'react';
import {
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  LoaderCircle,
  LockKeyhole,
  Play,
} from 'lucide-react';
import { api } from '../api';
import type { Event, Job, State } from '../types';

import { kindLabel, fmt } from '../lib/presentation';
import { Badge, Button, Field, Modal } from '../components/ui';
export function JobModal({
  state,
  initialJob,
  close,
  done,
  connect,
}: {
  state: State;
  initialJob: Job;
  close: () => void;
  done: (message: string) => Promise<void>;
  connect: (id: string) => void;
}) {
  const job = state.jobs.find((j) => j.id === initialJob.id) ?? initialJob;
  const project = state.projects.find((p) => p.id === job.project_id)!;
  const profile = state.profiles.find(
    (p) => p.project_id === job.project_id && p.platform_id === job.platform_id,
  );
  const [url, setUrl] = useState(profile?.url ?? ''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState('');
  const canResume =
    ['action_required', 'failed'].includes(job.status) && job.batch_status !== 'cancelled';
  const act = async (action: 'resume' | 'cancel') => {
    setBusy(true);
    setError('');
    try {
      await api(`/jobs/${job.id}/action`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          profile_url: action === 'resume' ? url || undefined : undefined,
        }),
      });
      await done(action === 'resume' ? 'Đã đưa công việc về hàng đợi.' : 'Đã hủy công việc.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(''), 1800);
    } catch {
      setError(
        'Trình duyệt chưa cho phép sao chép. Bạn có thể chọn nội dung và sao chép thủ công.',
      );
    }
  };
  const [jobEvents, setJobEvents] = useState<Event[]>([]);
  useEffect(() => {
    let active = true;
    void api<Event[]>(`/jobs/${job.id}/events`)
      .then((rows) => {
        if (active) setJobEvents(rows);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [job.id, job.updated_at]);
  const events = jobEvents.slice(0, 20);
  return (
    <Modal
      title={`${job.platform_name} · ${project.name}`}
      description={`${kindLabel[job.kind]} / ${job.batch_name}`}
      onClose={busy ? () => {} : close}
      wide
    >
      <div className="modal-body">
        <div className="job-status-row">
          <Badge status={job.status} />
          <span>
            Lần thử {job.attempts}/{job.max_attempts}
          </span>
          <span>Cập nhật {fmt(job.updated_at)}</span>
        </div>
        {job.reason && (
          <div className="info-strip">
            <CircleAlert size={18} />
            <p>{job.reason}</p>
          </div>
        )}
        <div className="job-detail-grid">
          <div>
            <h3 className="form-section-title">Thông tin để điền hồ sơ</h3>
            {[
              ['Tên thương hiệu', project.name],
              ['Username mong muốn', project.username],
              ['Website', project.website],
              [
                'Mô tả',
                job.connector === 'github'
                  ? project.description.slice(0, 160)
                  : job.connector === 'gitlab'
                    ? project.description.slice(0, 255)
                    : project.description,
              ],
              ['Email liên hệ', project.email],
              ['URL logo', project.logo_url],
            ].map(([key, value]) => (
              <div className="copy-field" key={key}>
                <span>{key}</span>
                <div>
                  <p>{value || 'Chưa có thông tin'}</p>
                  <button
                    className="icon-button"
                    aria-label={`Sao chép ${key}`}
                    onClick={() => void copy(value, key)}
                    disabled={!value}
                  >
                    {copied === key ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div>
            <h3 className="form-section-title">Hoàn tất & kiểm tra</h3>
            <p className="form-hint">
              Mở nền tảng để đăng ký hoặc hoàn thiện hồ sơ. Sau khi xử lý các bước xác minh, cung
              cấp URL công khai để công cụ kiểm tra.
            </p>
            <a
              className="button button-secondary external-button"
              href={job.registration_url}
              target="_blank"
              rel="noreferrer"
            >
              Mở {job.platform_name}
              <ExternalLink size={15} />
            </a>
            {job.connector !== 'manual' && (
              <Button variant="secondary" onClick={() => connect(job.project_id)}>
                <LockKeyhole size={15} />
                Kết nối tài khoản API
              </Button>
            )}
            <Field label="URL hồ sơ công khai">
              <input
                type="url"
                value={url}
                disabled={!canResume || busy}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://nen-tang.com/thuong-hieu"
              />
            </Field>
            <p className="form-hint">
              URL phải thuộc đúng nền tảng. URL được lưu sẽ được kiểm tra; công cụ chưa coi việc
              nhập URL là xác minh thành công.
            </p>
            <div className="job-timeline">
              <h3>Lịch sử gần đây</h3>
              {events.length ? (
                events.map((e) => (
                  <div key={e.id}>
                    <span className="timeline-dot" />
                    <small>{fmt(e.created_at)}</small>
                    <p>{e.message}</p>
                  </div>
                ))
              ) : (
                <p className="muted">Chưa có sự kiện cho công việc này.</p>
              )}
            </div>
          </div>
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          {['queued', 'retry', 'action_required'].includes(job.status) && (
            <Button variant="danger" onClick={() => void act('cancel')} disabled={busy}>
              Hủy tác vụ
            </Button>
          )}
          <Button variant="secondary" onClick={close} disabled={busy}>
            Đóng
          </Button>
          {canResume && (
            <Button onClick={() => void act('resume')} disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}Lưu & tiếp
              tục
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
