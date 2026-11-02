import { useEffect, useState } from 'react';
import {
  Activity,
  Braces,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  ClipboardList,
  FolderKanban,
  Globe2,
  Layers3,
  Link2,
  ListChecks,
  LoaderCircle,
  Mail,
  LockKeyhole,
  Menu,
  Network,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
  Workflow,
  X,
} from 'lucide-react';
import { api, downloadReport } from './api';
import type { Job, Platform, Profile, Project, State } from './types';

import { kindLabel, categoryLabel, fmt, domain, matches, cls } from './lib/presentation';
import { Badge, Button, Empty, SectionHeading, CheckValue } from './components/ui';
import { HealthPanel, JobsTable, BatchCard } from './components/WorkspaceWidgets';
import { ProjectModal } from './modals/ProjectModal';
import { BatchModal } from './modals/BatchModal';
import { ImportModal } from './modals/ImportModal';
import { AccountModal } from './modals/AccountModal';
import { JobModal } from './modals/JobModal';
import { PlatformModal } from './modals/PlatformModal';
import { GuideModal } from './modals/GuideModal';
import { SchemaModal } from './modals/SchemaModal';
import { MailboxModal } from './modals/MailboxModal';
import { Login } from './modals/Login';
import { ProfileModal, EvidenceModal } from './modals/ProfileModals';
type Page = 'overview' | 'projects' | 'platforms' | 'queue' | 'inbox' | 'profiles';
type ModalState =
  | { type: 'project'; project?: Project }
  | { type: 'batch'; projectId?: string; kind?: 'prepare' | 'verify' | 'sync' }
  | { type: 'import' }
  | { type: 'job'; job: Job }
  | { type: 'account'; projectId?: string }
  | { type: 'profile' }
  | { type: 'evidence'; profile: Profile }
  | { type: 'platform'; platform: Platform }
  | { type: 'guide' }
  | { type: 'schema'; project: Project }
  | { type: 'mailboxes' }
  | null;
export default function App() {
  const [state, setState] = useState<State | null>(null),
    [page, setPage] = useState<Page>('overview'),
    [modal, setModal] = useState<ModalState>(null);
  const [platformScope, setPlatformScope] = useState<'enabled' | 'review' | 'all'>('enabled'),
    [platformLimit, setPlatformLimit] = useState(48);
  const [projectFilter, setProjectFilter] = useState('all'),
    [query, setQuery] = useState(''),
    [toast, setToast] = useState(''),
    [error, setError] = useState(''),
    [needsAuth, setNeedsAuth] = useState(false),
    [menu, setMenu] = useState(false);
  const refresh = async () => {
    try {
      setState(await api<State>('/state'));
      setError('');
      setNeedsAuth(false);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 401) setNeedsAuth(true);
      else setError(err.message);
    }
  };
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => setPlatformLimit(48), [query, platformScope]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const notify = (message: string) => setToast(message);
  const action = async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn();
      await refresh();
      if (success) notify(success);
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const go = (next: Page) => {
    setPage(next);
    setQuery('');
    setMenu(false);
  };
  const open = (value: ModalState) => setModal(value);
  const close = () => setModal(null);
  const exported = (kind: 'profiles' | 'jobs') =>
    void action(() => downloadReport(kind), 'Đã xuất báo cáo CSV tương thích Excel.');
  if (needsAuth) return <Login onLogin={refresh} />;
  if (!state)
    return (
      <div className="loading-screen">
        <div className="brand-mark">
          <Network />
        </div>
        <h2>Entity Workspace</h2>
        {error ? (
          <>
            <p>{error}</p>
            <Button onClick={() => void refresh()}>Kết nối lại</Button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" />
            <p>Đang mở không gian làm việc…</p>
          </>
        )}
      </div>
    );
  const projects = state.projects.filter(
    (p) =>
      (projectFilter === 'all' || p.id === projectFilter) &&
      matches(query, p.name, p.website, p.username),
  );
  const jobs = state.jobs.filter(
    (j) =>
      (projectFilter === 'all' || j.project_id === projectFilter) &&
      matches(query, j.project_name, j.platform_name, j.reason, j.batch_name),
  );
  const profiles = state.profiles.filter(
    (p) =>
      (projectFilter === 'all' || p.project_id === projectFilter) &&
      matches(query, p.project_name, p.platform_name, p.url),
  );
  const waiting = jobs.filter((j) => ['action_required', 'failed'].includes(j.status));
  const visiblePlatforms = state.platforms.filter(
    (p) =>
      (platformScope === 'all' || (platformScope === 'enabled' ? !!p.enabled : !p.enabled)) &&
      matches(query, p.name, p.origin, categoryLabel[p.category]),
  );
  const nav: [Page, typeof Activity, string][] = [
    ['overview', Layers3, 'Tổng quan'],
    ['projects', FolderKanban, 'Dự án'],
    ['platforms', Globe2, 'Nền tảng'],
    ['queue', Workflow, 'Hàng đợi'],
    ['inbox', ClipboardList, 'Cần xử lý'],
    ['profiles', ShieldCheck, 'Hồ sơ & báo cáo'],
  ];
  return (
    <div className="app-shell">
      {menu && (
        <button className="sidebar-overlay" aria-label="Đóng menu" onClick={() => setMenu(false)} />
      )}
      <aside className={cls('sidebar', menu && 'sidebar-open')}>
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            go('overview');
          }}
        >
          <span className="brand-mark">
            <Network size={25} />
          </span>
          <span>
            entity<span className="brand-light">workspace</span>
          </span>
        </a>
        <div className="workspace-card">
          <span className="workspace-avatar">EW</span>
          <div>
            <strong>Workspace của bạn</strong>
            <span>Quản lý nhiều thương hiệu</span>
          </div>
        </div>
        <div className="nav-label">KHÔNG GIAN LÀM VIỆC</div>
        <nav>
          {nav.map(([id, Icon, label]) => (
            <button
              key={id}
              className={cls('nav-item', page === id && 'nav-active')}
              onClick={() => go(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === 'inbox' && state.stats.waiting > 0 && (
                <span className="nav-count">{state.stats.waiting}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="note-symbol">
            <ShieldCheck size={22} />
          </div>
          <strong>Xây hồ sơ. Giữ giá trị.</strong>
          <p>Theo dõi chất lượng hồ sơ qua từng lần kiểm tra.</p>
          <button onClick={() => open({ type: 'guide' })}>
            Cách sử dụng <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <span className="live-dot" />
          <span>Workspace đang kết nối</span>
          <span className="version">v0.1</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Mở menu"
            onClick={() => setMenu(true)}
          >
            <Menu />
          </button>
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <strong>{nav.find((n) => n[0] === page)?.[2]}</strong>
          </div>
          <div className="topbar-right">
            <div className="search-box">
              <Search size={17} />
              <input
                aria-label="Tìm kiếm"
                placeholder="Tìm trong trang…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  className="icon-button"
                  aria-label="Xóa tìm kiếm"
                  onClick={() => setQuery('')}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <span className="topbar-divider" />
            <button
              className="help-button"
              aria-label="Hướng dẫn sử dụng"
              onClick={() => open({ type: 'guide' })}
            >
              <CircleHelp size={20} />
            </button>
            <span className="user-avatar">EW</span>
          </div>
        </header>
        <main>
          {error && (
            <div role="alert" className="connection-error">
              <CircleAlert size={17} />
              {error} Dữ liệu đang hiển thị là lần tải gần nhất.
            </div>
          )}
          <div className="context-bar">
            <span>
              <span className="small-dot" /> ENTITY PROFILE MANAGEMENT
            </span>
            <label className="project-filter">
              <FolderKanban size={15} />
              <select
                aria-label="Lọc dự án"
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
              >
                <option value="all">Tất cả dự án</option>
                {state.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </label>
          </div>
          {page === 'overview' && (
            <>
              <SectionHeading
                title="Hệ hồ sơ của bạn, trong tầm kiểm soát."
                description="Một nơi để xây dựng, kiểm tra và duy trì hiện diện thương hiệu."
              >
                <Button variant="secondary" onClick={() => open({ type: 'import' })}>
                  <Upload size={16} />
                  Nhập danh sách
                </Button>
                <Button onClick={() => open({ type: 'project' })}>
                  <Plus size={17} />
                  Tạo dự án
                </Button>
              </SectionHeading>
              <div className="stats-grid">
                {[
                  {
                    label: 'Dự án đang quản lý',
                    value: state.stats.projects,
                    icon: FolderKanban,
                    note: 'Mỗi website, một bộ thông tin',
                    tone: 'green',
                  },
                  {
                    label: 'Hồ sơ đã lưu',
                    value: state.stats.profiles,
                    icon: Link2,
                    note: 'Tách riêng theo từng dự án',
                    tone: 'blue',
                  },
                  {
                    label: 'Đã xác minh hoạt động',
                    value: state.stats.healthy,
                    icon: ShieldCheck,
                    note: 'Khớp thương hiệu và website',
                    tone: 'green',
                  },
                  {
                    label: 'Đang chờ thao tác',
                    value: state.stats.waiting,
                    icon: ClipboardList,
                    note: 'Xác minh hoặc bổ sung dữ liệu',
                    tone: 'amber',
                  },
                ].map(({ label, value, icon: Icon, note, tone }) => (
                  <div className="stat-card" key={label}>
                    <div className="stat-top">
                      <span>{label}</span>
                      <span className={`stat-icon stat-${tone}`}>
                        <Icon size={18} />
                      </span>
                    </div>
                    <strong className="stat-value">{value.toLocaleString('vi-VN')}</strong>
                    <small>{note}</small>
                  </div>
                ))}
              </div>
              {state.projects.length === 0 ? (
                <div className="welcome-card">
                  <div className="welcome-copy">
                    <span className="pill">
                      <Sparkles size={13} />
                      BẮT ĐẦU TỪ THƯƠNG HIỆU
                    </span>
                    <h2>
                      Mỗi thương hiệu,
                      <br />
                      một hệ hồ sơ vững chắc.
                    </h2>
                    <p>
                      Chuẩn hóa thông tin một lần. Tổ chức công việc trên nhiều nền tảng và theo dõi
                      hồ sơ theo thời gian.
                    </p>
                    <Button onClick={() => open({ type: 'project' })}>
                      Tạo dự án đầu tiên <ArrowRight size={16} />
                    </Button>
                    <small>Chưa cần kết nối tài khoản để bắt đầu.</small>
                  </div>
                  <div className="entity-map" aria-hidden="true">
                    <div className="map-orbit orbit-one" />
                    <div className="map-orbit orbit-two" />
                    <div className="map-center">
                      <Network size={35} />
                      <span>THƯƠNG HIỆU</span>
                    </div>
                    <div className="map-node node-one">
                      <Globe2 size={21} />
                    </div>
                    <div className="map-node node-two">
                      <ShieldCheck size={22} />
                    </div>
                    <div className="map-node node-three">
                      <Link2 size={21} />
                    </div>
                    <div className="map-node node-four">
                      <FolderKanban size={21} />
                    </div>
                    <span className="map-label label-one">
                      <span className="small-dot" />
                      Thông tin nhất quán
                    </span>
                    <span className="map-label label-two">
                      <CheckCircle2 size={13} />
                      Theo dõi lâu dài
                    </span>
                  </div>
                </div>
              ) : (
                <div className="overview-grid">
                  <div className="panel">
                    <div className="panel-title">
                      <div>
                        <h2>Dự án gần đây</h2>
                        <p>Thông tin và tình trạng hồ sơ theo thương hiệu</p>
                      </div>
                      <button className="text-button" onClick={() => go('projects')}>
                        Tất cả <ArrowRight size={14} />
                      </button>
                    </div>
                    {projects.slice(0, 4).map((p) => (
                      <div className="project-list-row" key={p.id}>
                        <span className="project-avatar">{p.name.slice(0, 1).toUpperCase()}</span>
                        <div>
                          <strong>{p.name}</strong>
                          <small>{domain(p.website)}</small>
                        </div>
                        <div className="project-list-meta">
                          <strong>
                            {p.healthy_count}
                            <span> / {p.profile_count}</span>
                          </strong>
                          <small>đã xác minh</small>
                        </div>
                        <button
                          className="icon-button"
                          aria-label={`Mở hồ sơ ${p.name}`}
                          onClick={() => {
                            setProjectFilter(p.id);
                            go('profiles');
                          }}
                        >
                          <ChevronRight size={18} />
                        </button>
                      </div>
                    ))}
                    {projects.length === 0 && (
                      <p className="inline-empty">Không có dự án phù hợp bộ lọc.</p>
                    )}
                  </div>
                  <HealthPanel profiles={profiles} />
                </div>
              )}
              <div className="overview-grid">
                <div className="panel">
                  <div className="panel-title">
                    <div>
                      <h2>Công việc gần đây</h2>
                      <p>Tiến độ thực tế của các tác vụ</p>
                    </div>
                    <button className="text-button" onClick={() => go('queue')}>
                      Xem hàng đợi <ArrowRight size={14} />
                    </button>
                  </div>
                  {jobs.length ? (
                    <div className="compact-jobs">
                      {jobs.slice(0, 5).map((j) => (
                        <button
                          className="compact-job"
                          key={j.id}
                          onClick={() => open({ type: 'job', job: j })}
                        >
                          <span className="platform-mark">
                            {j.platform_name.slice(0, 1).toUpperCase()}
                          </span>
                          <div>
                            <strong>{j.platform_name}</strong>
                            <small>
                              {j.project_name} · {kindLabel[j.kind]}
                            </small>
                          </div>
                          <Badge status={j.status} />
                          <ChevronRight size={16} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      icon={ListChecks}
                      title="Hàng đợi đang trống"
                      description="Tạo một lô công việc sau khi thêm dự án và chọn nền tảng."
                    >
                      <Button
                        variant="secondary"
                        onClick={() => open({ type: 'batch' })}
                        disabled={!state.projects.length}
                      >
                        <Plus size={15} />
                        Tạo lô công việc
                      </Button>
                    </Empty>
                  )}
                </div>
                <div className="panel cadence-panel">
                  <div className="panel-title">
                    <div>
                      <h2>Hồ sơ cần được chăm sóc</h2>
                      <p>Lịch theo dõi sau khi xác minh lần đầu</p>
                    </div>
                    <Activity size={20} />
                  </div>
                  <div className="cadence">
                    <div>
                      <span>01</span>
                      <strong>Sau 1 ngày</strong>
                      <small>Kiểm tra lại sự hiện diện</small>
                    </div>
                    <div>
                      <span>07</span>
                      <strong>Sau 7 ngày</strong>
                      <small>Đối chiếu thông tin và liên kết</small>
                    </div>
                    <div>
                      <span>30</span>
                      <strong>Sau 30 ngày</strong>
                      <small>Tiếp tục theo dõi mỗi tháng</small>
                    </div>
                  </div>
                  <div className="subtle-note">
                    <CircleHelp size={16} />
                    <p>
                      Lịch tự động hoạt động khi ứng dụng đang chạy và dự án bật theo dõi. Các hồ sơ
                      cần xử lý sẽ chờ bạn xem xét.
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
          {page === 'projects' && (
            <>
              <SectionHeading
                title="Dự án"
                description="Bộ thông tin riêng cho mỗi website và thương hiệu."
              >
                <Button variant="secondary" onClick={() => open({ type: 'mailboxes' })}>
                  <Mail size={17} />
                  Hộp thư
                </Button>
                <Button onClick={() => open({ type: 'project' })}>
                  <Plus size={17} />
                  Tạo dự án
                </Button>
              </SectionHeading>
              {projects.length ? (
                <div className="project-grid">
                  {projects.map((p) => (
                    <article className="project-card" key={p.id}>
                      <div className="project-card-top">
                        <span className="project-avatar large">
                          {p.name.slice(0, 1).toUpperCase()}
                        </span>
                        <button
                          className="icon-button"
                          aria-label={`Chỉnh sửa ${p.name}`}
                          onClick={() => open({ type: 'project', project: p })}
                        >
                          <Pencil size={17} />
                        </button>
                      </div>
                      <h2>{p.name}</h2>
                      <a className="domain-link" href={p.website} target="_blank" rel="noreferrer">
                        {domain(p.website)}
                        <ArrowUpRight size={13} />
                      </a>
                      <p className="project-description">
                        {p.description || 'Chưa thêm mô tả thương hiệu.'}
                      </p>
                      <div className="project-facts">
                        <span>
                          <span className="muted">Username</span>
                          <strong>@{p.username}</strong>
                        </span>
                        <span>
                          <span className="muted">Theo dõi</span>
                          <strong className={p.monitoring ? 'green-text' : ''}>
                            {p.monitoring ? 'Đang bật' : 'Đã tắt'}
                          </strong>
                        </span>
                      </div>
                      <div className="project-progress-label">
                        <span>Hồ sơ đã xác minh</span>
                        <strong>
                          {p.healthy_count} / {p.profile_count}
                        </strong>
                      </div>
                      <div className="progress-track">
                        <span
                          style={{
                            width: `${p.profile_count ? (p.healthy_count / p.profile_count) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <div className="project-card-footer">
                        <Button
                          variant="secondary"
                          onClick={() => open({ type: 'schema', project: p })}
                        >
                          <Braces size={14} />
                          Schema
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => open({ type: 'account', projectId: p.id })}
                        >
                          <LockKeyhole size={14} />
                          Tài khoản
                        </Button>
                        <Button onClick={() => open({ type: 'batch', projectId: p.id })}>
                          Tạo công việc
                          <ArrowRight size={14} />
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="panel">
                  <Empty
                    title="Thêm thương hiệu đầu tiên"
                    description="Mỗi dự án lưu thông tin, tài khoản và hồ sơ độc lập."
                  >
                    <Button onClick={() => open({ type: 'project' })}>
                      <Plus size={16} />
                      Tạo dự án
                    </Button>
                  </Empty>
                </div>
              )}
            </>
          )}
          {page === 'platforms' && (
            <>
              <SectionHeading
                title="Danh mục nền tảng"
                description="Chọn nền tảng phù hợp và xem rõ khả năng tự động hóa."
              >
                <Button variant="secondary" onClick={() => open({ type: 'import' })}>
                  <Upload size={16} />
                  Nhập URL mẫu
                </Button>
              </SectionHeading>
              <div className="info-strip">
                <CircleHelp size={18} />
                <p>
                  <strong>URL mẫu dùng để xây danh mục.</strong> Hồ sơ và tài khoản của từng dự án
                  được quản lý riêng. Nền tảng mới nhập cần được xem xét trước khi bật.
                </p>
              </div>
              <div className="catalog-toolbar">
                <div className="segmented">
                  <button
                    className={platformScope === 'enabled' ? 'selected' : ''}
                    onClick={() => setPlatformScope('enabled')}
                  >
                    Đã bật ({state.platforms.filter((p) => p.enabled).length})
                  </button>
                  <button
                    className={platformScope === 'review' ? 'selected' : ''}
                    onClick={() => setPlatformScope('review')}
                  >
                    Cần xem xét ({state.platforms.filter((p) => !p.enabled).length})
                  </button>
                  <button
                    className={platformScope === 'all' ? 'selected' : ''}
                    onClick={() => setPlatformScope('all')}
                  >
                    Tất cả
                  </button>
                </div>
                <span className="muted">{visiblePlatforms.length} nền tảng</span>
              </div>
              <div className="platform-grid">
                {visiblePlatforms.slice(0, platformLimit).map((p) => (
                  <article
                    className={cls('platform-card', !p.enabled && 'platform-disabled')}
                    key={p.id}
                  >
                    <div className="platform-card-head">
                      <span
                        className={cls('platform-mark', p.connector !== 'manual' && 'platform-api')}
                      >
                        {p.name.slice(0, 1).toUpperCase()}
                      </span>
                      <div>
                        <h3>{p.name}</h3>
                        <span>{domain(p.origin)}</span>
                      </div>
                      <button
                        className="icon-button"
                        aria-label={`Cấu hình ${p.name}`}
                        onClick={() => open({ type: 'platform', platform: p })}
                      >
                        <Settings2 size={17} />
                      </button>
                    </div>
                    <span className="category">{categoryLabel[p.category]}</span>
                    <div className="connector-info">
                      {p.connector === 'manual' ? (
                        <ClipboardList size={16} />
                      ) : (
                        <Workflow size={16} />
                      )}
                      <strong>
                        {p.connector === 'manual' ? 'Đăng ký có hỗ trợ' : 'API · cập nhật hồ sơ'}
                      </strong>
                    </div>
                    <p>
                      {p.connector === 'manual'
                        ? 'Chuẩn bị thông tin, xử lý xác minh và kiểm tra URL công khai.'
                        : 'Đồng bộ tên, mô tả và website trên tài khoản đã kết nối.'}
                    </p>
                    <div className="platform-card-footer">
                      {!p.enabled ? (
                        <span className="review-label">Cần xem xét</span>
                      ) : p.paused ? (
                        <Badge status="paused" />
                      ) : (
                        <span className="ready-label">
                          <span className="small-dot" />
                          Đã bật
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        onClick={() =>
                          void action(
                            () =>
                              api(`/platforms/${p.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ enabled: !p.enabled }),
                              }),
                            p.enabled ? 'Đã tắt nền tảng.' : 'Đã bật nền tảng.',
                          )
                        }
                      >
                        {p.enabled ? 'Tắt' : 'Bật nền tảng'}
                        <ArrowRight size={13} />
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
              {visiblePlatforms.length > platformLimit && (
                <div className="load-more">
                  <Button variant="secondary" onClick={() => setPlatformLimit((n) => n + 48)}>
                    Xem thêm nền tảng
                  </Button>
                </div>
              )}
              {visiblePlatforms.length === 0 && (
                <div className="panel">
                  <Empty
                    icon={Globe2}
                    title="Chưa có nền tảng phù hợp"
                    description="Thay đổi bộ lọc hoặc nhập thêm danh sách URL mẫu."
                  />
                </div>
              )}
            </>
          )}
          {page === 'queue' && (
            <>
              <SectionHeading
                title="Hàng đợi công việc"
                description="Tạm dừng, tiếp tục và đối soát từng lô công việc."
              >
                <Button variant="secondary" onClick={() => exported('jobs')}>
                  <ArrowDownToLine size={16} />
                  Xuất CSV
                </Button>
                <Button
                  onClick={() =>
                    open({
                      type: 'batch',
                      projectId: projectFilter !== 'all' ? projectFilter : undefined,
                    })
                  }
                >
                  <Plus size={17} />
                  Tạo lô công việc
                </Button>
              </SectionHeading>
              {state.batches.length > 0 && (
                <div className="batch-strip">
                  {state.batches.slice(0, 6).map((b) => (
                    <BatchCard
                      key={b.id}
                      batch={b}
                      onAction={(a) =>
                        void action(
                          () =>
                            api(`/batches/${b.id}/action`, {
                              method: 'POST',
                              body: JSON.stringify({ action: a }),
                            }),
                          'Đã cập nhật lô công việc.',
                        )
                      }
                    />
                  ))}
                </div>
              )}
              <div className="panel table-panel">
                <div className="table-toolbar">
                  <h2>
                    Tác vụ <span className="count-label">{jobs.length}</span>
                  </h2>
                  <span className="muted">Hiển thị tối đa 2.000 tác vụ gần nhất</span>
                </div>
                {jobs.length ? (
                  <JobsTable jobs={jobs} openJob={(j) => open({ type: 'job', job: j })} />
                ) : (
                  <Empty
                    icon={Workflow}
                    title="Chưa có công việc"
                    description="Chọn dự án và nền tảng để tạo một lô đầu tiên."
                  >
                    <Button
                      onClick={() => open({ type: 'batch' })}
                      disabled={!state.projects.length}
                    >
                      Tạo lô công việc
                      <ArrowRight size={15} />
                    </Button>
                  </Empty>
                )}
              </div>
            </>
          )}
          {page === 'inbox' && (
            <>
              <SectionHeading
                title="Cần bạn xử lý"
                description="Giải quyết xác minh, bổ sung URL và tiếp tục công việc bị gián đoạn."
              >
                <span className="inbox-count">{waiting.length} công việc</span>
              </SectionHeading>
              {waiting.length ? (
                <div className="inbox-grid">
                  {waiting.map((j) => (
                    <article className="inbox-card" key={j.id}>
                      <div className="inbox-top">
                        <span className="platform-mark">
                          {j.platform_name.slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <h3>{j.platform_name}</h3>
                          <small>{j.project_name}</small>
                        </div>
                        <Badge status={j.status} />
                      </div>
                      <p>{j.reason}</p>
                      <div className="inbox-footer">
                        <span>
                          {kindLabel[j.kind]} · Lần {j.attempts}
                        </span>
                        <Button variant="secondary" onClick={() => open({ type: 'job', job: j })}>
                          Xử lý
                          <ArrowRight size={15} />
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="panel">
                  <Empty
                    icon={CheckCircle2}
                    title="Không có việc đang chờ"
                    description="Những bước cần xác minh hoặc kiểm tra thủ công sẽ xuất hiện ở đây."
                  />
                </div>
              )}
            </>
          )}
          {page === 'profiles' && (
            <>
              <SectionHeading
                title="Hồ sơ & báo cáo"
                description="Tách biệt tình trạng hồ sơ, thương hiệu và liên kết về website."
              >
                <Button variant="secondary" onClick={() => exported('profiles')}>
                  <ArrowDownToLine size={16} />
                  Xuất CSV
                </Button>
                <Button variant="secondary" onClick={() => open({ type: 'profile' })}>
                  <Link2 size={16} />
                  Thêm URL
                </Button>
                <Button
                  onClick={() =>
                    open({
                      type: 'batch',
                      kind: 'verify',
                      projectId: projectFilter !== 'all' ? projectFilter : undefined,
                    })
                  }
                >
                  <ShieldCheck size={16} />
                  Tạo lô kiểm tra
                </Button>
              </SectionHeading>
              <div className="profile-summary">
                <span>
                  <i className="legend-dot green-bg" />
                  {profiles.filter((p) => p.status === 'healthy').length} đã xác minh
                </span>
                <span>
                  <i className="legend-dot amber-bg" />
                  {
                    profiles.filter((p) =>
                      ['needs_review', 'unknown', 'unavailable'].includes(p.status),
                    ).length
                  }{' '}
                  cần xem xét
                </span>
                <span>
                  <i className="legend-dot gray-bg" />
                  {profiles.filter((p) => p.status === 'unverified').length} chưa kiểm tra
                </span>
              </div>
              <div className="panel table-panel">
                {profiles.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Hồ sơ / dự án</th>
                          <th>Trạng thái</th>
                          <th>Thương hiệu</th>
                          <th>Backlink</th>
                          <th>Kiểm tra gần nhất</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {profiles.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <a
                                className="table-link"
                                href={p.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {p.platform_name}
                                <ArrowUpRight size={13} />
                              </a>
                              <small>{p.project_name}</small>
                            </td>
                            <td>
                              <Badge status={p.status} />
                            </td>
                            <td>
                              <CheckValue value={p.identity_match} />
                            </td>
                            <td>
                              <CheckValue value={p.backlink} />
                            </td>
                            <td>
                              <span className="date-cell">{fmt(p.last_checked)}</span>
                            </td>
                            <td>
                              <button
                                className="text-button"
                                onClick={() => open({ type: 'evidence', profile: p })}
                              >
                                Chi tiết
                                <ChevronRight size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    icon={Link2}
                    title="Chưa có hồ sơ được lưu"
                    description="Thêm URL có sẵn hoặc hoàn tất hồ sơ từ hàng đợi để bắt đầu theo dõi."
                  >
                    <Button
                      variant="secondary"
                      onClick={() => open({ type: 'profile' })}
                      disabled={!state.projects.length}
                    >
                      Thêm URL hồ sơ
                    </Button>
                  </Empty>
                )}
              </div>
              <div className="subtle-note report-note">
                <CircleHelp size={16} />
                <p>
                  “Đang hoạt động” thể hiện kết quả lần kiểm tra gần nhất. Khả năng Google lập chỉ
                  mục chưa được xác nhận bởi công cụ này. Thời gian hiển thị theo múi giờ Việt Nam.
                </p>
              </div>
            </>
          )}
          <footer className="page-footer">
            <span>
              Entity Workspace <span> / </span> Xây dựng hiện diện có thể theo dõi.
            </span>
            <button onClick={() => open({ type: 'guide' })}>
              <BookOpen size={14} />
              Hướng dẫn sử dụng
            </button>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CircleAlert size={18} />
          <span>{toast}</span>
          <button aria-label="Đóng thông báo" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {modal?.type === 'project' && (
        <ProjectModal
          project={modal.project}
          mailboxes={state.mailboxes}
          close={close}
          done={async () => {
            await refresh();
            close();
            notify('Đã lưu dự án.');
          }}
        />
      )}
      {modal?.type === 'batch' && (
        <BatchModal
          state={state}
          initialProject={modal.projectId}
          initialKind={modal.kind}
          close={close}
          done={async (message) => {
            await refresh();
            close();
            go('queue');
            notify(message);
          }}
        />
      )}
      {modal?.type === 'import' && (
        <ImportModal
          state={state}
          close={close}
          done={async (message) => {
            await refresh();
            close();
            notify(message);
          }}
        />
      )}
      {modal?.type === 'account' && (
        <AccountModal
          state={state}
          initialProject={modal.projectId}
          close={close}
          refresh={refresh}
          notify={notify}
        />
      )}
      {modal?.type === 'job' && (
        <JobModal
          state={state}
          initialJob={modal.job}
          close={close}
          done={async (message) => {
            await refresh();
            close();
            notify(message);
          }}
          connect={(id) => open({ type: 'account', projectId: id })}
        />
      )}
      {modal?.type === 'profile' && (
        <ProfileModal
          state={state}
          close={close}
          done={async () => {
            await refresh();
            close();
            notify('Đã lưu URL. Tạo lô kiểm tra để xác minh hồ sơ.');
          }}
        />
      )}
      {modal?.type === 'evidence' && (
        <EvidenceModal
          profile={state.profiles.find((p) => p.id === modal.profile.id) ?? modal.profile}
          close={close}
          verify={() =>
            void action(
              () =>
                api('/batches', {
                  method: 'POST',
                  body: JSON.stringify({
                    name: 'Kiểm tra lại hồ sơ',
                    project_ids: [modal.profile.project_id],
                    platform_ids: [modal.profile.platform_id],
                    kind: 'verify',
                  }),
                }),
              'Đã đưa yêu cầu kiểm tra vào hàng đợi.',
            )
          }
        />
      )}
      {modal?.type === 'platform' && (
        <PlatformModal
          platform={modal.platform}
          close={close}
          done={async () => {
            await refresh();
            close();
            notify('Đã lưu cấu hình nền tảng.');
          }}
        />
      )}
      {modal?.type === 'guide' && <GuideModal close={close} />}
      {modal?.type === 'mailboxes' && (
        <MailboxModal state={state} close={close} refresh={refresh} notify={notify} />
      )}
      {modal?.type === 'schema' && <SchemaModal project={modal.project} close={close} />}
    </div>
  );
}
