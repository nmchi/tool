import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHtml, Connectors, payloadFor } from '../server/connectors.js';
import { parseImport } from '../server/catalog.js';
import { normalizedUrl, publicUrl, assertPublicDestination, safeCsv } from '../server/urls.js';
import { createNetwork, retryDelay } from '../server/network.js';
import { projectInput } from './helpers.js';

const project = { ...projectInput(), name: 'Mộc Studio', website: 'https://moc.example.com' };
test('URL import removes tracking duplicates, preserves meaningful IDs and excludes non-profile URL types', () => {
  const input = `URL\nhttps://github.com/example/?utm_source=test\nhttps://github.com/example\nhttps://www.fcc.gov/fcc-bin/bye?https://example.com\nhttps://www.easycounter.com/report/example.com\nhttps://community.example.com/forum/topic/123\nhttps://community.example.com/user?id=12\nhttps://community.example.com/user?id=13`;
  const result = parseImport(input);
  assert.equal(result.total, 7);
  assert.equal(result.duplicates, 1);
  assert.deepEqual(
    result.rows.map((r) => r.kind),
    ['profile', 'redirect', 'report', 'content', 'unknown', 'unknown'],
  );
  assert.match(result.rows[4].url, /id=12/);
  assert.match(result.rows[5].url, /id=13/);
  assert.equal(
    normalizedUrl('https://github.com/example/?locale=en#about'),
    'https://github.com/example',
  );
  assert.equal(
    normalizedUrl('https://community.example.com/app#!/users/42'),
    'https://community.example.com/app#!/users/42',
  );
});
test('rejects credentials, non-http protocols, IP literals and private DNS destinations', async () => {
  for (const value of [
    'file:///etc/passwd',
    'http://127.0.0.1/a',
    'https://user:secret@example.com',
    'http://[::1]/',
    'http://a.local/a',
    'https://a.example.com:8080',
  ])
    assert.throws(() => publicUrl(value));
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '::1',
    'fc00::1',
    '::ffff:127.0.0.1',
  ])
    await assert.rejects(
      assertPublicDestination('https://safe.example.com', async () => [
        { address, family: address.includes(':') ? 6 : 4 },
      ]),
      /không phải địa chỉ Internet/,
    );
  await assertPublicDestination('https://safe.example.com', async () => [
    { address: '93.184.216.34', family: 4 },
  ]);
});
test('network guard prevents the transport from contacting private or unlisted hosts', async () => {
  let called = false;
  const network = createNetwork({
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    fetchImpl: async () => {
      called = true;
      throw new Error('must not fetch');
    },
  });
  try {
    await assert.rejects(
      network.request('https://safe.example.com', { allowedHosts: ['safe.example.com'] }),
      /Internet công khai/,
    );
    await assert.rejects(
      network.request('https://other.example.com', { allowedHosts: ['safe.example.com'] }),
      /nằm ngoài/,
    );
    assert.equal(called, false);
  } finally {
    await network.close();
  }
});
test('a live page must contain both the brand and an actual matching backlink', () => {
  const good = analyzeHtml(
    '<title>Mộc Studio</title><body><h1>Mộc Studio</h1><a href="https://moc.example.com/about">Website</a></body>',
    'https://social.example.com/moc',
    project,
  );
  assert.equal(good.status, 'healthy');
  assert.equal(good.backlink, true);
  const textOnly = analyzeHtml(
    '<body>Mộc Studio moc.example.com <a href="https://evil.example/?u=https://moc.example.com">Liên kết</a></body>',
    'https://social.example.com/moc',
    project,
  );
  assert.equal(textOnly.status, 'needs_review');
  assert.equal(textOnly.backlink, false);
  const wrongBrand = analyzeHtml(
    '<body>Thương hiệu khác <a href="https://moc.example.com">Website</a></body>',
    'https://social.example.com/moc',
    project,
  );
  assert.equal(wrongBrand.status, 'needs_review');
  assert.equal(wrongBrand.identity_match, false);
});
test('HTTP-200 login/challenge pages cannot be reported as a healthy profile; noindex stays separate', () => {
  const challenge = analyzeHtml(
    '<title>Just a moment...</title><body>Mộc Studio<a href="https://moc.example.com">Website</a></body>',
    'https://social.example.com/moc',
    project,
  );
  assert.equal(challenge.status, 'unknown');
  const login = analyzeHtml(
    '<title>Sign in</title><body><input type="password">Mộc Studio<a href="https://moc.example.com">Website</a></body>',
    'https://social.example.com/moc',
    project,
  );
  assert.equal(login.status, 'unknown');
  const noindex = analyzeHtml(
    '<head><meta name="robots" content="noindex"></head><body>Mộc Studio<a href="https://moc.example.com">Website</a></body>',
    'https://social.example.com/moc',
    project,
  );
  assert.equal(noindex.status, 'healthy');
  assert.equal(noindex.indexability, 'noindex');
});
test('cross-platform redirects and a 404 are never counted as healthy', async () => {
  const platform = { origin: 'https://social.example.com', connector: 'manual' };
  const redirect = new Connectors({
    request: async () => ({
      status: 302,
      headers: { location: 'https://other.example.com/profile' },
      body: '',
    }),
  });
  await assert.rejects(
    redirect.verify(project, platform, 'https://social.example.com/moc'),
    /nền tảng khác/,
  );
  const gone = new Connectors({
    request: async () => ({ status: 404, headers: {}, body: 'not found' }),
  });
  assert.equal(
    (await gone.verify(project, platform, 'https://social.example.com/moc')).status,
    'unavailable',
  );
});
test('CSV neutralizes formula injection and quotes embedded delimiters', () => {
  assert.equal(safeCsv([['=cmd()', 'a"b', 'x,y']]), '\uFEFF"\'=cmd()","a""b","x,y"');
  assert.match(safeCsv([['  @SUM(1)']]), /"'  @SUM/);
});
test('connector payloads apply documented field limits without inventing facts', () => {
  const p = { ...project, description: 'a'.repeat(300) };
  assert.equal(payloadFor(p, 'github').bio.length, 160);
  assert.equal(payloadFor(p, 'gitlab').bio.length, 255);
  assert.equal(payloadFor(p, 'manual').description.length, 300);
});
test('Retry-After handles seconds, dates, malformed and extreme values', () => {
  assert.equal(retryDelay({ headers: { 'retry-after': '120' } }), 120000);
  assert.equal(retryDelay({ headers: { 'retry-after': '99999999' } }), 3600000);
  assert.equal(retryDelay({ headers: { 'retry-after': 'invalid' } }), 60000);
  const reset = retryDelay({
    headers: { 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1800) },
  });
  assert.ok(reset > 1798000 && reset <= 1800000);
});
