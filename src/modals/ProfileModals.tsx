import { useEffect, useState, type FormEvent } from 'react';
import { Check, ExternalLink, FileText, Link2, LoaderCircle, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import type { Profile, State } from '../types';

import { fmt } from '../lib/presentation';
import { Badge, Button, Field, Modal, CheckValue } from '../components/ui';
export function ProfileModal({
  state,
  close,
  done,
}: {
  state: State;
  close: () => void;
  done: () => Promise<void>;
}) {
  const [projectId, setProjectId] = useState(''),
    [platformId, setPlatformId] = useState(''),
    [url, setUrl] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/profiles', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId, platform_id: platformId, url }),
      });
      await done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Thêm URL hồ sơ"
      description="Lưu hồ sơ thực tế thuộc thương hiệu để kiểm tra và theo dõi."
      onClose={busy ? () => {} : close}
    >
      <form onSubmit={submit} className="modal-body">
        <Field label="Dự án *">
          <select required value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Chọn dự án</option>
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nền tảng *">
          <select required value={platformId} onChange={(e) => setPlatformId(e.target.value)}>
            <option value="">Chọn nền tảng</option>
            {state.platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {!p.enabled ? ' · chưa bật' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="URL hồ sơ công khai *"
          hint="Nếu cặp dự án–nền tảng đã có hồ sơ, URL mới sẽ thay URL cũ và cần xác minh lại."
        >
          <input
            required
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://platform.com/thuong-hieu"
          />
        </Field>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <Button variant="secondary" onClick={close} disabled={busy}>
            Hủy
          </Button>
          <Button type="submit" disabled={busy || !projectId || !platformId}>
            <Link2 size={15} />
            Lưu URL
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function EvidenceModal({
  profile: p,
  close,
  verify,
}: {
  profile: Profile;
  close: () => void;
  verify: () => void;
}) {
  return (
    <Modal
      title={`${p.platform_name} · ${p.project_name}`}
      description="Kết quả kiểm tra gần nhất của hồ sơ công khai."
      onClose={close}
    >
      <div className="modal-body">
        <Badge status={p.status} />
        <a className="evidence-url" href={p.url} target="_blank" rel="noreferrer">
          {p.url}
          <ExternalLink size={15} />
        </a>
        <p>{p.evidence?.reason ?? 'Hồ sơ này chưa được kiểm tra.'}</p>
        <div className="evidence-grid">
          <div>
            <span>Thương hiệu</span>
            <CheckValue value={p.identity_match} />
          </div>
          <div>
            <span>Liên kết website</span>
            <CheckValue value={p.backlink} />
          </div>
          <div>
            <span>Kiểm tra gần nhất</span>
            <strong>{fmt(p.last_checked)}</strong>
          </div>
          <div>
            <span>Lịch kiểm tra tiếp</span>
            <strong>{fmt(p.next_check)}</strong>
          </div>
          <div>
            <span>Xác minh lần đầu</span>
            <strong>{fmt(p.first_verified)}</strong>
          </div>
          <div>
            <span>Chỉ thị lập chỉ mục</span>
            <strong>
              {p.evidence?.indexability === 'noindex' ? 'Có noindex' : 'Chưa xác định'}
            </strong>
          </div>
          <div>
            <span>Phương thức</span>
            <strong>
              {p.evidence?.method === 'github_public_api'
                ? 'API công khai'
                : p.evidence?.method === 'public_html'
                  ? 'Nội dung HTML công khai'
                  : '—'}
            </strong>
          </div>
          <div>
            <span>HTTP</span>
            <strong>{p.evidence?.http_status ?? '—'}</strong>
          </div>
        </div>
        {p.evidence?.title && (
          <div className="subtle-note">
            <FileText size={16} />
            <p>Tiêu đề nhận được: {p.evidence.title}</p>
          </div>
        )}
        <ProfileManagement profile={p} />
        <div className="modal-actions">
          <Button variant="secondary" onClick={close}>
            Đóng
          </Button>
          <Button onClick={verify}>
            <ShieldCheck size={15} />
            Kiểm tra lại
          </Button>
        </div>
      </div>
    </Modal>
  );
}
function ProfileManagement({ profile: p }: { profile: Profile }) {
  const [form, setForm] = useState({
    account_email: p.account_email,
    email_verified: p.email_verified,
    two_factor: p.two_factor,
    owner_confirmed: !!p.owner_confirmed,
  });
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [history, setHistory] = useState<
      {
        id: number;
        status: string;
        checked_at: number;
        evidence: { reason: string; url?: string };
      }[]
    >([]);
  useEffect(() => {
    let active = true;
    void api<typeof history>(`/profiles/${p.id}/history`)
      .then((rows) => {
        if (active) setHistory(rows);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [p.id, p.last_checked]);
  const save = async () => {
    setBusy(true);
    setMessage('');
    try {
      await api(`/profiles/${p.id}/checklist`, { method: 'PATCH', body: JSON.stringify(form) });
      setMessage('Đã lưu thông tin do bạn xác nhận.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="profile-management">
      <h3 className="form-section-title">Quản lý quyền sở hữu</h3>
      <p className="form-hint">
        Các mục dưới đây do bạn kiểm tra và khai báo; công cụ chưa xác minh email hoặc 2FA qua nền
        tảng. Không nhập mật khẩu hoặc mã khôi phục.
      </p>
      <Field label="Email quản lý tài khoản">
        <input
          type="email"
          value={form.account_email}
          onChange={(e) => setForm({ ...form, account_email: e.target.value })}
          placeholder="Email lâu dài do bạn quản lý"
        />
      </Field>
      <div className="form-grid">
        <Field label="Email đã xác minh">
          <select
            value={form.email_verified}
            onChange={(e) =>
              setForm({ ...form, email_verified: e.target.value as Profile['email_verified'] })
            }
          >
            <option value="unknown">Chưa kiểm tra</option>
            <option value="yes">Đã xác minh</option>
            <option value="no">Chưa xác minh</option>
          </select>
        </Field>
        <Field label="Bảo mật hai lớp (2FA)">
          <select
            value={form.two_factor}
            onChange={(e) =>
              setForm({ ...form, two_factor: e.target.value as Profile['two_factor'] })
            }
          >
            <option value="unknown">Chưa kiểm tra</option>
            <option value="enabled">Đã bật</option>
            <option value="disabled">Chưa bật</option>
            <option value="unavailable">Nền tảng không hỗ trợ</option>
          </select>
        </Field>
      </div>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={form.owner_confirmed}
          onChange={(e) => setForm({ ...form, owner_confirmed: e.target.checked })}
        />
        Tôi đã kiểm tra và còn quyền quản lý tài khoản này.
      </label>
      <Button variant="secondary" onClick={() => void save()} disabled={busy}>
        {busy ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}Lưu thông tin quản
        lý
      </Button>
      {message && (
        <p className="form-hint" role="status">
          {message}
        </p>
      )}
      <div className="profile-history">
        <h3 className="form-section-title">Lịch sử kiểm tra công khai</h3>
        {history.length ? (
          history.slice(0, 20).map((check) => (
            <div key={check.id}>
              <div>
                <span>{fmt(check.checked_at)}</span>
                <Badge status={check.status} />
              </div>
              <p>{check.evidence.reason}</p>
              {check.evidence.url && <small>{check.evidence.url}</small>}
            </div>
          ))
        ) : (
          <p className="form-hint">Chưa có lịch sử kiểm tra.</p>
        )}
      </div>
    </div>
  );
}
