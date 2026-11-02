import { MoreHorizontal, Pause, Play, ShieldCheck, X } from 'lucide-react';

import type { Batch, Job, Profile } from '../types';

import { kindLabel, fmt } from '../lib/presentation';
import { Badge } from '../components/ui';
export function HealthPanel({ profiles }: { profiles: Profile[] }) {
  const healthy = profiles.filter((p) => p.status === 'healthy').length,
    percent = profiles.length ? Math.round((healthy / profiles.length) * 100) : 0;
  return (
    <div className="panel health-panel">
      <div className="panel-title">
        <div>
          <h2>Chất lượng hồ sơ</h2>
          <p>Dựa trên kết quả đã kiểm tra</p>
        </div>
        <ShieldCheck size={20} />
      </div>
      <div className="health-content">
        <div className="donut">
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="41" fill="none" stroke="#edf0eb" strokeWidth="9" />
            <circle
              cx="50"
              cy="50"
              r="41"
              fill="none"
              stroke="#26785d"
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={`${percent * 2.576} 257.6`}
              transform="rotate(-90 50 50)"
            />
          </svg>
          <div>
            <strong>
              {percent}
              <small>%</small>
            </strong>
            <span>đã xác minh</span>
          </div>
        </div>
        <div className="health-legend">
          <span>
            <i className="legend-dot green-bg" />
            Đã xác minh<strong>{healthy}</strong>
          </span>
          <span>
            <i className="legend-dot amber-bg" />
            Cần xem xét
            <strong>
              {
                profiles.filter((p) =>
                  ['unknown', 'needs_review', 'unavailable'].includes(p.status),
                ).length
              }
            </strong>
          </span>
          <span>
            <i className="legend-dot gray-bg" />
            Chưa kiểm tra<strong>{profiles.filter((p) => p.status === 'unverified').length}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}
export function JobsTable({ jobs, openJob }: { jobs: Job[]; openJob: (job: Job) => void }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Dự án / nền tảng</th>
            <th>Công việc</th>
            <th>Trạng thái</th>
            <th>Lần thử</th>
            <th>Cập nhật</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td>
                <strong>{j.platform_name}</strong>
                <small>{j.project_name}</small>
              </td>
              <td>
                {kindLabel[j.kind]}
                {j.batch_status === 'paused' && <small>Lô đang tạm dừng</small>}
                {j.status === 'retry' && <small>Thử lại: {fmt(j.available_at)}</small>}
              </td>
              <td>
                <Badge status={j.status} />
              </td>
              <td>
                {j.attempts} / {j.max_attempts}
              </td>
              <td>
                <span className="date-cell">{fmt(j.updated_at)}</span>
              </td>
              <td>
                <button
                  className="icon-button"
                  aria-label={`Chi tiết ${j.platform_name} ${j.project_name}`}
                  onClick={() => openJob(j)}
                >
                  <MoreHorizontal size={19} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function BatchCard({
  batch: b,
  onAction,
}: {
  batch: Batch;
  onAction: (action: 'pause' | 'resume' | 'cancel') => void;
}) {
  const finished = b.total - b.pending - b.waiting;
  return (
    <div className="batch-card">
      <div>
        <strong>{b.name}</strong>
        <Badge status={b.status} />
      </div>
      <small>
        {finished}/{b.total} đã xử lý · {b.waiting || 0} cần thao tác
        {b.failed ? ` · ${b.failed} lỗi` : ''}
      </small>
      <div className="batch-controls">
        {b.status !== 'cancelled' && (
          <>
            <button
              title={b.status === 'paused' ? 'Tiếp tục lô' : 'Tạm dừng lô'}
              aria-label={b.status === 'paused' ? 'Tiếp tục lô' : 'Tạm dừng lô'}
              onClick={() => onAction(b.status === 'paused' ? 'resume' : 'pause')}
            >
              {b.status === 'paused' ? <Play size={14} /> : <Pause size={14} />}
            </button>
            <button
              title="Hủy các tác vụ chưa chạy"
              aria-label="Hủy lô"
              onClick={() => onAction('cancel')}
            >
              <X size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
