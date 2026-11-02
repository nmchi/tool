import { useState, type FormEvent } from 'react';
import {
  CircleAlert,
  ClipboardList,
  Layers3,
  LoaderCircle,
  Play,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import { api } from '../api';
import type { State } from '../types';

import { kindLabel, domain, cls } from '../lib/presentation';
import { Button, Field, Modal } from '../components/ui';
export function BatchModal({
  state,
  initialProject,
  initialKind,
  close,
  done,
}: {
  state: State;
  initialProject?: string;
  initialKind?: 'prepare' | 'verify' | 'sync';
  close: () => void;
  done: (message: string) => Promise<void>;
}) {
  const [name, setName] = useState('Lô công việc mới'),
    [kind, setKind] = useState<'prepare' | 'verify' | 'sync'>(initialKind ?? 'prepare'),
    [projectIds, setProjectIds] = useState<string[]>(initialProject ? [initialProject] : []),
    [platformIds, setPlatformIds] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const platforms = state.platforms.filter(
    (p) => p.enabled && (kind !== 'sync' || p.connector !== 'manual'),
  );
  const selectedPlatforms = platformIds.filter((id) => platforms.some((p) => p.id === id));
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((v) => v !== id) : [...list, id];
  const count = projectIds.length * selectedPlatforms.length;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ created: number; skipped: number }>('/batches', {
        method: 'POST',
        body: JSON.stringify({
          name,
          kind,
          project_ids: projectIds,
          platform_ids: selectedPlatforms,
        }),
      });
      await done(
        `Đã tạo ${result.created} tác vụ; ${result.skipped} cặp trùng hoặc chưa bật được bỏ qua.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Tạo lô công việc"
      description="Chọn thao tác, dự án và nền tảng. Mỗi cặp có tiến độ riêng."
      onClose={busy ? () => {} : close}
      wide
    >
      <form className="modal-body" onSubmit={submit}>
        <Field label="Tên lô *">
          <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="mode-grid">
          {(['prepare', 'verify', 'sync'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={cls('mode-option', kind === k && 'mode-selected')}
              onClick={() => setKind(k)}
            >
              {k === 'prepare' ? (
                <ClipboardList size={20} />
              ) : k === 'verify' ? (
                <ShieldCheck size={20} />
              ) : (
                <Workflow size={20} />
              )}
              <strong>{kindLabel[k]}</strong>
              <small>
                {k === 'prepare'
                  ? 'Hỗ trợ đăng ký, nhận URL và kiểm tra'
                  : k === 'verify'
                    ? 'Kiểm tra công khai các URL đã lưu'
                    : 'Cập nhật tài khoản GitHub / GitLab'}
              </small>
            </button>
          ))}
        </div>
        {kind === 'sync' && (
          <div className="info-strip">
            <CircleAlert size={17} />
            <p>
              Tác vụ cập nhật <strong>tên, mô tả và website</strong> của tài khoản đã kết nối.
              GitHub dùng 160 ký tự mô tả, GitLab 255 ký tự. Chọn đúng tài khoản của thương hiệu.
            </p>
          </div>
        )}
        <div className="form-grid selection-grid">
          <div>
            <div className="selection-label">
              <strong>Dự án</strong>
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  setProjectIds(
                    projectIds.length === state.projects.length
                      ? []
                      : state.projects.map((p) => p.id),
                  )
                }
              >
                Chọn tất cả
              </button>
            </div>
            <div className="selection-list">
              {state.projects.length ? (
                state.projects.map((p) => (
                  <label key={p.id} className="selection-row">
                    <input
                      type="checkbox"
                      checked={projectIds.includes(p.id)}
                      onChange={() => setProjectIds(toggle(projectIds, p.id))}
                    />
                    <span>
                      <strong>{p.name}</strong>
                      <small>{domain(p.website)}</small>
                    </span>
                  </label>
                ))
              ) : (
                <p className="inline-empty">Tạo dự án trước khi thêm công việc.</p>
              )}
            </div>
          </div>
          <div>
            <div className="selection-label">
              <strong>Nền tảng</strong>
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  setPlatformIds(
                    selectedPlatforms.length === platforms.length ? [] : platforms.map((p) => p.id),
                  )
                }
              >
                Chọn tất cả
              </button>
            </div>
            <div className="selection-list">
              {platforms.map((p) => (
                <label key={p.id} className="selection-row">
                  <input
                    type="checkbox"
                    checked={selectedPlatforms.includes(p.id)}
                    onChange={() => setPlatformIds(toggle(platformIds, p.id))}
                  />
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      {p.paused
                        ? 'Đang tạm dừng'
                        : p.connector === 'manual'
                          ? 'Có hỗ trợ thủ công'
                          : 'API cập nhật hồ sơ'}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="batch-preview">
          <Layers3 size={20} />
          <div>
            <strong>
              {projectIds.length} dự án × {selectedPlatforms.length} nền tảng = {count} tác vụ dự
              kiến
            </strong>
            <p>
              Tối đa 500 cặp mỗi lô. Cặp có cùng công việc đang mở sẽ được bỏ qua. Tác vụ cần xác
              minh chuyển vào “Cần xử lý”.
            </p>
          </div>
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <Button variant="secondary" onClick={close} disabled={busy}>
            Hủy
          </Button>
          <Button type="submit" disabled={busy || !count || count > 500}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}Tạo và chạy lô
          </Button>
        </div>
      </form>
    </Modal>
  );
}
