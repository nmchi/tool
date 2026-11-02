import { useEffect, useState } from 'react';
import { ArrowDownToLine, Check, CircleAlert, Copy, LoaderCircle } from 'lucide-react';
import { api } from '../api';
import type { Project } from '../types';

import { Badge, Button, Modal } from '../components/ui';

type SchemaResult = {
  html: string;
  included: { platform_name: string; url: string }[];
  pending: { platform_name: string; url: string; status: string }[];
};

export function SchemaModal({ project, close }: { project: Project; close: () => void }) {
  const [result, setResult] = useState<SchemaResult | null>(null),
    [error, setError] = useState(''),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    api<SchemaResult>(`/projects/${project.id}/schema`)
      .then(setResult)
      .catch((e: Error) => setError(e.message));
  }, [project.id]);
  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.html);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Trình duyệt chưa cho phép sao chép. Hãy chọn nội dung và sao chép thủ công.');
    }
  };
  const download = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.html], { type: 'text/html' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${project.username}-entity-schema.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Modal
      wide
      title={`Schema entity · ${project.name}`}
      description="JSON-LD nối website với các hồ sơ đã xác minh qua thuộc tính sameAs. Dán vào thẻ <head> của trang chủ."
      onClose={close}
    >
      <div className="modal-body">
        {!result && !error && (
          <p className="muted">
            <LoaderCircle size={15} className="spin" /> Đang tạo schema…
          </p>
        )}
        {result && (
          <>
            <div className="info-strip">
              <CircleAlert size={17} />
              <p>
                <strong>{result.included.length}</strong> hồ sơ đã xác minh được đưa vào sameAs.
                {result.pending.length > 0 && (
                  <>
                    {' '}
                    <strong>{result.pending.length}</strong> hồ sơ chưa ở trạng thái “Đang hoạt
                    động” nên chưa được đưa vào. Tạo lại schema sau khi chúng được xác minh.
                  </>
                )}
              </p>
            </div>
            <pre className="schema-code">{result.html}</pre>
            {result.pending.length > 0 && (
              <details className="schema-pending">
                <summary>Hồ sơ chưa đưa vào ({result.pending.length})</summary>
                <ul>
                  {result.pending.map((p) => (
                    <li key={p.url}>
                      <Badge status={p.status} /> {p.platform_name} · {p.url}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <Button variant="secondary" onClick={download} disabled={!result}>
            <ArrowDownToLine size={15} />
            Tải xuống
          </Button>
          <Button onClick={() => void copy()} disabled={!result}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? 'Đã sao chép' : 'Sao chép mã'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
