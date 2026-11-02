import { Store } from '../server/store.js';
export const projectInput = (suffix = 'one') => ({
  name: `Thương hiệu ${suffix}`,
  website: `https://${suffix}.example.com`,
  username: `brand-${suffix}`,
  description: 'Dịch vụ sáng tạo dành cho thương hiệu.',
  email: '',
  logo_url: '',
  entity_type: 'organization',
  monitoring: true,
});
export function setupStore() {
  const store = new Store();
  const project = store.createProject(projectInput());
  store.run('UPDATE platforms SET interval_ms=0');
  return { store, project };
}
export function enqueue(store, project, kind = 'verify', platform = 'github') {
  const batch = store.createBatch({
    name: 'Kiểm thử',
    project_ids: [project.id],
    platform_ids: [platform],
    kind,
  });
  return store.get('SELECT * FROM jobs WHERE batch_id=?', batch.id);
}
export const healthy = (url = 'https://github.com/brand-one') => ({
  status: 'healthy',
  identity_match: true,
  backlink: true,
  reason: 'Đúng thương hiệu và website.',
  url,
  checked_at: Date.now(),
  method: 'fixture',
});
