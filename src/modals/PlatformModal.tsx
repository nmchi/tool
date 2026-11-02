import { useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import { api } from '../api';
import type { Platform } from '../types';

import { Button, Field, Modal } from '../components/ui';
export function PlatformModal({
  platform: p,
  close,
  done,
}: {
  platform: Platform;
  close: () => void;
  done: () => Promise<void>;
}) {
  const [name, setName] = useState(p.name),
    [registration, setRegistration] = useState(p.registration_url),
    [template, setTemplate] = useState(p.profile_template),
    [interval, setIntervalValue] = useState(p.interval_ms / 1000),
    [enabled, setEnabled] = useState(!!p.enabled),
    [paused, setPaused] = useState(!!p.paused),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/platforms/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          registration_url: registration,
          profile_template: template,
          interval_ms: interval * 1000,
          enabled,
          paused,
        }),
      });
      await done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Cấu hình ${p.name}`} description={p.origin} onClose={busy ? () => {} : close}>
      <form className="modal-body" onSubmit={submit}>
        <Field label="Tên hiển thị">
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Trang đăng ký / quản lý">
          <input
            required
            type="url"
            value={registration}
            onChange={(e) => setRegistration(e.target.value)}
          />
        </Field>
        <Field
          label="Mẫu URL tham khảo"
          hint="Dùng {username} làm vị trí username. Công cụ không coi URL dự đoán là hồ sơ đã tồn tại."
        >
          <input
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            placeholder={`${p.origin}/{username}`}
          />
        </Field>
        <Field
          label="Khoảng cách giữa tác vụ (giây)"
          hint="Áp dụng chung cho các dự án cùng nền tảng. Tối thiểu 10 giây."
        >
          <input
            type="number"
            min={10}
            max={3600}
            step={1}
            required
            value={interval}
            onChange={(e) => setIntervalValue(Number(e.target.value))}
          />
        </Field>
        <label className="checkbox-label">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Đã xem xét và bật nền tảng này
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
          Tạm dừng nhận tác vụ mới
        </label>
        {p.samples.length > 0 && <p className="form-hint">Nguồn tham khảo: {p.samples[0]}</p>}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <Button variant="secondary" onClick={close} disabled={busy}>
            Đóng
          </Button>
          <Button type="submit" disabled={busy}>
            <Check size={15} />
            Lưu cấu hình
          </Button>
        </div>
      </form>
    </Modal>
  );
}
