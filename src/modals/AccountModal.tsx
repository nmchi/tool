import { useState, type FormEvent } from 'react';
import { Link2, LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import type { Account, State } from '../types';

import { fmt } from '../lib/presentation';
import { Button, Field, Modal } from '../components/ui';
export function AccountModal({
  state,
  initialProject,
  close,
  refresh,
  notify,
}: {
  state: State;
  initialProject?: string;
  close: () => void;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [projectId, setProjectId] = useState(initialProject ?? ''),
    [platformId, setPlatformId] = useState('github'),
    [token, setToken] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const accounts = state.accounts.filter((a) => !projectId || a.project_id === projectId);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ username: string }>('/accounts', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId, platform_id: platformId, token }),
      });
      setToken('');
      await refresh();
      notify(
        `Đã xác minh tài khoản @${result.username}. Chưa cập nhật hồ sơ; tạo lô API để thực hiện.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async (a: Account) => {
    setBusy(true);
    try {
      await api(`/accounts/${a.id}`, { method: 'DELETE' });
      await refresh();
      notify('Đã ngắt kết nối. Bạn có thể thu hồi token trên nền tảng.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Tài khoản kết nối"
      description="Xác minh tài khoản trước khi cho phép cập nhật hồ sơ qua API."
      onClose={busy ? () => {} : close}
    >
      <form className="modal-body" onSubmit={submit}>
        <div className="form-grid">
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
          <Field label="Nền tảng API">
            <select value={platformId} onChange={(e) => setPlatformId(e.target.value)}>
              {state.platforms
                .filter((p) => p.connector !== 'manual')
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <Field
          label="Access token *"
          hint={
            platformId === 'github'
              ? 'GitHub: token có quyền đọc/cập nhật hồ sơ người dùng (user hoặc quyền Profile phù hợp).'
              : 'GitLab: token có quyền api để đọc và cập nhật hồ sơ.'
          }
        >
          <input
            required
            type="password"
            autoComplete="off"
            minLength={10}
            maxLength={4096}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Token chỉ nhập ở đây, không đưa vào mô tả dự án"
          />
        </Field>
        <div className="subtle-note">
          <LockKeyhole size={17} />
          <p>
            Token được mã hóa tại máy chủ và không xuất vào báo cáo. Mỗi tài khoản API được gắn với
            một dự án. Email, CAPTCHA và 2FA được xử lý trực tiếp trên nền tảng.
          </p>
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <Button variant="secondary" onClick={close} disabled={busy}>
            Đóng
          </Button>
          <Button type="submit" disabled={busy || !projectId || !token}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />}Xác minh & kết
            nối
          </Button>
        </div>
        <div className="connected-list">
          <h3>Tài khoản đã kết nối</h3>
          {accounts.length ? (
            accounts.map((a) => (
              <div className="connected-account" key={a.id}>
                <span className="platform-mark">
                  <ShieldCheck size={18} />
                </span>
                <div>
                  <strong>
                    {state.platforms.find((p) => p.id === a.platform_id)?.name} · @{a.username}
                  </strong>
                  <small>
                    {state.projects.find((p) => p.id === a.project_id)?.name} · {fmt(a.verified_at)}
                  </small>
                </div>
                <button
                  type="button"
                  className="text-button danger-text"
                  disabled={busy}
                  onClick={() => void disconnect(a)}
                >
                  Ngắt kết nối
                </button>
              </div>
            ))
          ) : (
            <p className="inline-empty">Chưa có tài khoản cho lựa chọn này.</p>
          )}
        </div>
      </form>
    </Modal>
  );
}
