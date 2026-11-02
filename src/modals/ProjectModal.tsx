import { useState, type FormEvent } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { api } from '../api';
import type { Project } from '../types';

import { Button, Field, Modal } from '../components/ui';
export function ProjectModal({
  project,
  close,
  done,
}: {
  project?: Project;
  close: () => void;
  done: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: project?.name ?? '',
    website: project?.website ?? '',
    username: project?.username ?? '',
    description: project?.description ?? '',
    email: project?.email ?? '',
    logo_url: project?.logo_url ?? '',
    entity_type: project?.entity_type ?? 'organization',
    monitoring: project ? !!project.monitoring : true,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(project ? `/projects/${project.id}` : '/projects', {
        method: project ? 'PUT' : 'POST',
        body: JSON.stringify(form),
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
      title={project ? 'Chỉnh sửa dự án' : 'Tạo dự án mới'}
      description="Thông tin chuẩn được dùng cho hồ sơ của thương hiệu này."
      onClose={busy ? () => {} : close}
    >
      <form onSubmit={submit} className="modal-body">
        <div className="form-grid">
          <Field label="Tên thương hiệu *">
            <input
              required
              minLength={2}
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ví dụ: Mộc Studio"
            />
          </Field>
          <Field label="Loại thực thể">
            <select
              value={form.entity_type}
              onChange={(e) =>
                setForm({ ...form, entity_type: e.target.value as 'organization' | 'person' })
              }
            >
              <option value="organization">Tổ chức / thương hiệu</option>
              <option value="person">Cá nhân</option>
            </select>
          </Field>
          <Field label="Website chính thức *">
            <input
              required
              type="url"
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
              placeholder="https://website-cua-ban.vn"
            />
          </Field>
          <Field label="Username mong muốn *" hint="Có thể khác username thực tế sau khi đăng ký.">
            <input
              required
              pattern="[a-zA-Z0-9_.\-]+"
              minLength={2}
              maxLength={60}
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="mocstudio"
            />
          </Field>
        </div>
        <Field
          label="Mô tả thương hiệu"
          hint={`${form.description.length}/2.000 ký tự. GitHub dùng tối đa 160, GitLab 255 ký tự.`}
        >
          <textarea
            rows={4}
            maxLength={2000}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Mô tả chính xác thương hiệu, sản phẩm hoặc lĩnh vực hoạt động."
          />
        </Field>
        <div className="form-grid">
          <Field label="Email liên hệ" hint="Dùng email lâu dài do bạn quản lý.">
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="hello@website-cua-ban.vn"
            />
          </Field>
          <Field label="URL logo" hint="Lưu tham chiếu; bản này chưa tự tải logo lên nền tảng.">
            <input
              type="url"
              value={form.logo_url}
              onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
              placeholder="https://website-cua-ban.vn/logo.png"
            />
          </Field>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={form.monitoring}
            onChange={(e) => setForm({ ...form, monitoring: e.target.checked })}
          />
          <span>
            <strong>Theo dõi định kỳ</strong>
            <small>Tự tạo kiểm tra đến hạn khi ứng dụng đang chạy.</small>
          </span>
        </label>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <Button variant="secondary" onClick={close} disabled={busy}>
            Hủy
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}Lưu dự án
          </Button>
        </div>
      </form>
    </Modal>
  );
}
