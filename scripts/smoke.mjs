const port = process.env.PORT || 4310;
const base = `http://127.0.0.1:${port}`;
const headers = process.env.ENTITY_ACCESS_TOKEN
  ? { Authorization: `Bearer ${process.env.ENTITY_ACCESS_TOKEN}` }
  : {};
const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) });
if (!health.ok || !(await health.json()).ok) throw new Error('Health check chưa đạt.');
const response = await fetch(`${base}/api/state`, { headers, signal: AbortSignal.timeout(5000) });
if (!response.ok) throw new Error(`State API trả HTTP ${response.status}.`);
const state = await response.json();
if (
  !Array.isArray(state.projects) ||
  !Array.isArray(state.platforms) ||
  !Array.isArray(state.jobs) ||
  !state.platforms.some((p) => p.id === 'github')
)
  throw new Error('State API chưa đủ dữ liệu.');
const frontend = await fetch(base, { signal: AbortSignal.timeout(5000) });
const html = await frontend.text();
if (!frontend.ok || !html.includes('id="root"') || !html.includes('/assets/'))
  throw new Error('Chưa phục vụ bản build giao diện.');
console.log(
  `Smoke check đạt: giao diện + API; ${state.projects.length} dự án, ${state.platforms.length} nền tảng, ${state.jobs.length} tác vụ đang hiển thị.`,
);
