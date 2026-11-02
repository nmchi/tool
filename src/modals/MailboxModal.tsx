import { useState, type FormEvent } from 'react';
import { CircleAlert, LoaderCircle, Mail, Plug, Trash2 } from 'lucide-react';
import { api } from '../api';
import type { Mailbox, State } from '../types';

import { fmt } from '../lib/presentation';
import { Button, Field, Modal } from '../components/ui';

// Presets map the user's choice to a stored provider. Gmail and Google Workspace App
// Passwords both use IMAP at imap.gmail.com.
const PRESETS = {
  gmail: {
    label: 'Gmail / Google Workspace (App Password)',
    provider: 'imap',
    host: 'imap.gmail.com',
  },
  workspace: { label: 'Google Workspace (service account)', provider: 'gmail_api', host: '' },
  imap: { label: 'IMAP khác (Zoho, hosting…)', provider: 'imap', host: '' },
  manual: { label: 'Thủ công (tự mở link xác minh)', provider: 'manual', host: '' },
} as const;
type Preset = keyof typeof PRESETS;
export const providerLabel = (m: Mailbox) =>
  m.provider === 'gmail_api'
    ? PRESETS.workspace.label
    : m.provider === 'manual'
      ? PRESETS.manual.label
      : m.imap_host === 'imap.gmail.com'
        ? PRESETS.gmail.label
        : `IMAP · ${m.imap_host}`;

export function MailboxModal({
  state,
  close,
  refresh,
  notify,
}: {
  state: State;
  close: () => void;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [preset, setPreset] = useState<Preset>('gmail'),
    [form, setForm] = useState({ name: '', address: '', imap_host: '' }),
    [secret, setSecret] = useState(''),
    [testTo, setTestTo] = useState<Record<string, string>>({}),
    [results, setResults] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const chosen = PRESETS[preset];
  const usedBy = (id: string) => state.projects.filter((p) => p.mailbox_id === id);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('create');
    setError('');
    try {
      await api('/mailboxes', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          provider: chosen.provider,
          imap_host: chosen.provider === 'imap' ? chosen.host || form.imap_host : '',
          secret: chosen.provider === 'manual' ? '' : secret,
        }),
      });
      setSecret('');
      setForm({ name: '', address: '', imap_host: '' });
      await refresh();
      notify('Đã kết nối hộp thư. Chọn hộp thư này trong cài đặt dự án.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const test = async (m: Mailbox) => {
    setBusy(m.id);
    setError('');
    try {
      const result = await api<{
        messages: { from: string; subject: string; date: number }[];
        manual?: boolean;
      }>(`/mailboxes/${m.id}/test`, {
        method: 'POST',
        body: JSON.stringify({ to: testTo[m.id] || '' }),
      });
      setResults({
        ...results,
        [m.id]: result.manual
          ? 'Hộp thư thủ công: ứng dụng không đọc thư.'
          : result.messages.length
            ? `Kết nối tốt. Thư gần đây: ${result.messages
                .map((x) => `“${x.subject}” (${x.from}, ${fmt(x.date)})`)
                .join('; ')}`
            : 'Kết nối tốt. Chưa có thư nào trong 3 ngày qua khớp địa chỉ này.',
      });
      await refresh();
    } catch (e) {
      setResults({ ...results, [m.id]: (e as Error).message });
    } finally {
      setBusy('');
    }
  };
  const remove = async (m: Mailbox) => {
    setBusy(m.id);
    try {
      await api(`/mailboxes/${m.id}`, { method: 'DELETE' });
      await refresh();
      notify('Đã xóa hộp thư. Thu hồi App Password hoặc khóa service account nếu không dùng nữa.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  return (
    <Modal
      wide
      title="Hộp thư xác minh"
      description="Ứng dụng đọc thư xác nhận đăng ký từ các hộp thư này. Một hộp thư có thể dùng cho nhiều dự án."
      onClose={busy ? () => {} : close}
    >
      <div className="modal-body">
        {state.mailboxes.length > 0 && (
          <div className="mailbox-list">
            {state.mailboxes.map((m) => (
              <div className="mailbox-item" key={m.id}>
                <div className="mailbox-head">
                  <Mail size={17} />
                  <div>
                    <strong>{m.name}</strong>
                    <small>
                      {m.address} · {providerLabel(m)}
                    </small>
                    <small>
                      Dự án:{' '}
                      {usedBy(m.id)
                        .map((p) => p.name)
                        .join(', ') || 'chưa dùng'}
                      {m.verified_at ? ` · Kiểm tra lần cuối ${fmt(m.verified_at)}` : ''}
                    </small>
                  </div>
                  <Button variant="ghost" onClick={() => void remove(m)} disabled={!!busy}>
                    <Trash2 size={14} />
                    Xóa
                  </Button>
                </div>
                {m.provider !== 'manual' && (
                  <div className="mailbox-test">
                    <input
                      type="email"
                      aria-label={`Địa chỉ nhận cần kiểm tra cho ${m.name}`}
                      placeholder="Địa chỉ nhận cần kiểm tra (để trống: mọi thư)"
                      value={testTo[m.id] ?? ''}
                      onChange={(e) => setTestTo({ ...testTo, [m.id]: e.target.value })}
                    />
                    <Button variant="secondary" onClick={() => void test(m)} disabled={!!busy}>
                      {busy === m.id ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : (
                        <Plug size={14} />
                      )}
                      Kiểm tra
                    </Button>
                  </div>
                )}
                {results[m.id] && <p className="mailbox-result">{results[m.id]}</p>}
              </div>
            ))}
          </div>
        )}
        <form onSubmit={submit}>
          <h3 className="form-section-title">Thêm hộp thư</h3>
          <div className="form-grid">
            <Field label="Loại kết nối">
              <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
                {Object.entries(PRESETS).map(([key, p]) => (
                  <option key={key} value={key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tên gợi nhớ *">
              <input
                required
                maxLength={100}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ví dụ: Hộp thư Workspace chung"
              />
            </Field>
            <Field
              label="Địa chỉ hộp thư *"
              hint={
                chosen.provider === 'gmail_api'
                  ? 'Hộp thư trong Workspace mà service account được phép đọc.'
                  : 'Địa chỉ đăng nhập của hộp thư.'
              }
            >
              <input
                required
                type="email"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="contact@website-cua-ban.vn"
              />
            </Field>
            {preset === 'imap' && (
              <Field label="Máy chủ IMAP *" hint="Kết nối qua TLS, cổng 993.">
                <input
                  required
                  value={form.imap_host}
                  onChange={(e) => setForm({ ...form, imap_host: e.target.value })}
                  placeholder="imap.zoho.com"
                />
              </Field>
            )}
          </div>
          {chosen.provider === 'imap' && (
            <Field
              label="App Password *"
              hint={
                preset === 'gmail'
                  ? 'Bật xác minh 2 bước, rồi tạo tại myaccount.google.com → Bảo mật → Mật khẩu ứng dụng. Không dùng mật khẩu đăng nhập chính.'
                  : 'Mật khẩu ứng dụng hoặc mật khẩu IMAP do nhà cung cấp cấp.'
              }
            >
              <input
                required
                type="password"
                autoComplete="off"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
            </Field>
          )}
          {chosen.provider === 'gmail_api' && (
            <Field
              label="Khóa JSON của service account *"
              hint="Admin Workspace cấp domain-wide delegation cho client ID của service account với phạm vi https://www.googleapis.com/auth/gmail.readonly."
            >
              <textarea
                required
                rows={5}
                autoComplete="off"
                spellCheck={false}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder='{"type": "service_account", ...}'
              />
            </Field>
          )}
          <div className="info-strip">
            <CircleAlert size={17} />
            <p>
              Mỗi website dùng <strong>một email riêng</strong>, và mọi hồ sơ entity của website đó
              đăng ký bằng <strong>đúng email ấy</strong>. Gmail cá nhân chỉ phục vụ được website có
              email trùng địa chỉ Gmail; hộp thư Workspace có thể nhận alias của nhiều website.
            </p>
          </div>
          {chosen.provider === 'manual' && (
            <div className="info-strip">
              <CircleAlert size={17} />
              <p>Ứng dụng không đọc hộp thư này. Bạn sẽ tự mở thư và bấm link xác minh.</p>
            </div>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="modal-actions">
            <Button variant="secondary" onClick={close} disabled={!!busy}>
              Đóng
            </Button>
            <Button type="submit" disabled={!!busy}>
              {busy === 'create' ? <LoaderCircle className="spin" size={16} /> : <Plug size={16} />}
              Kiểm tra & lưu
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
