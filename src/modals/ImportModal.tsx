import { useState } from 'react';
import { FileText, Globe2, LoaderCircle, Search, Upload } from 'lucide-react';
import { api } from '../api';
import type { ImportPreview, State } from '../types';

import { cls } from '../lib/presentation';
import { Button, Field, Modal } from '../components/ui';
export function ImportModal({
  state,
  close,
  done,
}: {
  state: State;
  close: () => void;
  done: (message: string) => Promise<void>;
}) {
  const [text, setText] = useState(''),
    [preview, setPreview] = useState<ImportPreview | null>(null),
    [mode, setMode] = useState<'catalog' | 'profiles'>('catalog'),
    [projectId, setProjectId] = useState(''),
    [includeUnknown, setIncludeUnknown] = useState(false),
    [owned, setOwned] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const inspect = async () => {
    setBusy(true);
    setError('');
    try {
      setPreview(
        await api<ImportPreview>('/import/preview', {
          method: 'POST',
          body: JSON.stringify({ text }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const loadReference = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ text: string }>('/reference-urls');
      setText(result.text);
      setPreview(null);
      if (!result.text)
        setError('Chưa có tệp tham khảo trong bản cài đặt này. Bạn có thể chọn tệp riêng.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ created: number; skipped: number }>('/import/commit', {
        method: 'POST',
        body: JSON.stringify({
          text,
          mode,
          project_id: projectId || undefined,
          include_unknown: includeUnknown,
        }),
      });
      await done(
        `Đã nhập ${result.created} ${mode === 'catalog' ? 'nền tảng' : 'hồ sơ'}; bỏ qua ${result.skipped}. Nền tảng mới ở trạng thái cần xem xét.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Nhập danh sách URL"
      description="Dùng URL kết quả làm nguồn khảo sát nền tảng hoặc nhập hồ sơ đã có của một dự án."
      onClose={busy ? () => {} : close}
      wide
    >
      <div className="modal-body">
        <div className="segmented">
          <button
            className={mode === 'catalog' ? 'selected' : ''}
            onClick={() => setMode('catalog')}
          >
            Danh mục nền tảng
          </button>
          <button
            className={mode === 'profiles' ? 'selected' : ''}
            onClick={() => setMode('profiles')}
          >
            Hồ sơ của dự án
          </button>
        </div>
        {mode === 'catalog' ? (
          <div className="info-strip">
            <Globe2 size={18} />
            <p>
              Chỉ nhập nền tảng từ URL mẫu. Username và thương hiệu trong URL mẫu không được gán cho
              dự án của bạn.
            </p>
          </div>
        ) : (
          <>
            <Field label="Dự án sở hữu hồ sơ">
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Chọn dự án</option>
                {state.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <label className="checkbox-label">
              <input type="checkbox" checked={owned} onChange={(e) => setOwned(e.target.checked)} />
              <span>Danh sách này gồm hồ sơ thực tế của dự án đã chọn.</span>
            </label>
          </>
        )}
        <Field
          label="Dán URL hoặc chọn tệp TXT / CSV"
          hint="Mỗi lần tối đa 2.000 URL. Phân loại theo cấu trúc URL, chưa kiểm tra trực tiếp."
        >
          <textarea
            rows={6}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPreview(null);
            }}
            placeholder={
              'https://platform.example/ten-thuong-hieu\nhttps://community.example/users/ten-thuong-hieu'
            }
          />
        </Field>
        <div className="import-file-row">
          {mode === 'catalog' && (
            <Button variant="ghost" onClick={() => void loadReference()} disabled={busy}>
              <FileText size={15} />
              Nạp danh sách tham khảo
            </Button>
          )}
          <label className="file-button">
            <Upload size={15} />
            Chọn tệp
            <input
              aria-label="Chọn tệp URL"
              type="file"
              accept=".txt,.csv,text/plain,text/csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 400000) {
                  setError('Tệp tối đa 400 KB.');
                  return;
                }
                setText(await file.text());
                setPreview(null);
              }}
            />
          </label>
          <Button
            variant="secondary"
            onClick={() => void inspect()}
            disabled={busy || !text.trim()}
          >
            {busy ? <LoaderCircle className="spin" size={15} /> : <Search size={15} />}Phân tích
            danh sách
          </Button>
        </div>
        {preview && (
          <>
            <div className="import-summary">
              <span>
                <strong>{preview.total}</strong> URL đầu vào
              </span>
              <span>
                <strong>{preview.duplicates}</strong> URL trùng
              </span>
              <span>
                <strong>
                  {
                    preview.rows.filter((r) =>
                      ['report', 'redirect', 'content', 'invalid'].includes(r.kind),
                    ).length
                  }
                </strong>{' '}
                không phù hợp hồ sơ
              </span>
            </div>
            <div className="import-preview table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>URL</th>
                    <th>Phân loại sơ bộ</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 100).map((r, i) => (
                    <tr key={i}>
                      <td title={r.url ?? r.input}>
                        {r.host ?? r.input}
                        <small>{r.reason}</small>
                      </td>
                      <td>
                        <span className={cls('kind-tag', `kind-${r.kind}`)}>
                          {
                            {
                              profile: 'Dạng hồ sơ',
                              unknown: 'Chưa rõ',
                              report: 'Báo cáo',
                              redirect: 'Chuyển hướng',
                              content: 'Bài đăng',
                              invalid: 'Không hợp lệ',
                            }[r.kind]
                          }
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.rows.length > 100 && (
              <small className="muted">
                Xem trước 100/{preview.rows.length} URL; thao tác nhập áp dụng toàn danh sách.
              </small>
            )}
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={includeUnknown}
                onChange={(e) => setIncludeUnknown(e.target.checked)}
              />
              <span>Nhập cả URL chưa phân loại để xem xét sau.</span>
            </label>
            <p className="form-hint">
              URL chuyển hướng, báo cáo và bài đăng được bỏ qua. Mỗi dự án–nền tảng lưu một hồ sơ;
              hồ sơ đã có được giữ nguyên.
            </p>
          </>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <Button variant="secondary" onClick={close} disabled={busy}>
            Đóng
          </Button>
          <Button
            onClick={() => void commit()}
            disabled={
              busy ||
              !preview ||
              preview.total === 0 ||
              (mode === 'profiles' && (!projectId || !owned))
            }
          >
            <Upload size={16} />
            Nhập {mode === 'catalog' ? 'nền tảng' : 'hồ sơ'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
