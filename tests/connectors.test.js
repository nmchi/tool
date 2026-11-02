import test from 'node:test';
import assert from 'node:assert/strict';
import { Connectors } from '../server/connectors.js';
import { projectInput } from './helpers.js';

const response = (data, status = 200) => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(data),
});
test('gitlab: sync never writes (non-admin API is read-only) and hands mismatches to the operator', async () => {
  const project = { ...projectInput(), name: 'Mộc Studio' };
  const platform = { connector: 'gitlab', origin: 'https://gitlab.com' };
  let user = {
    id: 7,
    username: 'moc',
    web_url: 'https://gitlab.com/moc',
    name: 'Old',
    bio: 'old',
    website_url: '',
  };
  let writes = 0;
  const api = new Connectors({
    request: async (url, options) => {
      assert.match(url, /^https:\/\/gitlab.com\/api\/v4\/user$/);
      if (options.method && options.method !== 'GET') writes++;
      return response(user);
    },
  });
  await assert.rejects(api.sync(project, platform, { remote_id: '7' }, 'test-token'), (error) => {
    assert.equal(error.action, true);
    assert.match(error.message, /GitLab không cho phép/);
    return true;
  });
  user = {
    ...user,
    name: project.name,
    bio: project.description.slice(0, 255),
    website_url: project.website,
  };
  const result = await api.sync(project, platform, { remote_id: '7' }, 'test-token');
  assert.equal(result.changed, false);
  assert.equal(writes, 0);
});
for (const provider of ['github'])
  test(`${provider}: sync authenticates ownership, reads before updating and makes repeat runs idempotent`, async () => {
    const project = { ...projectInput(), name: 'Mộc Studio' };
    const platform = {
      connector: provider,
      origin: provider === 'github' ? 'https://github.com' : 'https://gitlab.com',
    };
    let user =
      provider === 'github'
        ? {
            id: 7,
            login: 'moc',
            html_url: 'https://github.com/moc',
            name: 'Old',
            bio: 'old',
            blog: '',
          }
        : {
            id: 7,
            username: 'moc',
            web_url: 'https://gitlab.com/moc',
            name: 'Old',
            bio: 'old',
            website_url: '',
          };
    let writes = 0;
    const api = new Connectors({
      request: async (url, options) => {
        assert.match(
          url,
          provider === 'github' ? /^https:\/\/api.github.com/ : /^https:\/\/gitlab.com/,
        );
        assert.equal(options.headers.Authorization, 'Bearer test-token');
        if (options.method === 'PATCH' || options.method === 'PUT') {
          writes++;
          user = { ...user, ...JSON.parse(options.body) };
        }
        return response(user);
      },
    });
    const account = { remote_id: '7' };
    assert.equal((await api.sync(project, platform, account, 'test-token')).changed, true);
    assert.equal((await api.sync(project, platform, account, 'test-token')).changed, false);
    assert.equal(writes, 1);
    assert.equal(user.name, project.name);
    await assert.rejects(
      api.sync(project, platform, { remote_id: '8' }, 'test-token'),
      /tài khoản khác/,
    );
    assert.equal(writes, 1);
  });
test('GitHub public verification checks real name and website, without forwarding a private token', async () => {
  const project = projectInput();
  const api = new Connectors({
    request: async (url, options) => {
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(url, 'https://api.github.com/users/brand-one');
      return response({ id: 7, login: 'brand-one', name: project.name, blog: project.website });
    },
  });
  const result = await api.verify(
    project,
    { connector: 'github', origin: 'https://github.com' },
    'https://github.com/brand-one',
  );
  assert.equal(result.status, 'healthy');
  assert.equal(result.backlink, true);
});
