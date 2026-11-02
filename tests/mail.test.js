import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import {
  createMail,
  normalizeMessage,
  platformMessages,
  verificationLinks,
  parseServiceAccount,
} from '../server/mail.js';

const raw = (to, html) =>
  Buffer.from(
    [
      'From: Example <noreply@example-platform.com>',
      `To: ${to}`,
      'Subject: Confirm your account',
      'Date: Mon, 2 Nov 2026 10:00:00 +0000',
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      html,
    ].join('\r\n'),
  );
const lookup = async () => [{ address: '142.250.1.1', family: 4 }];

test('mail to the shared website address is matched to a platform by sender or links', async () => {
  const at = (from, html, date) =>
    normalizeMessage(
      from,
      Buffer.from(
        [
          `From: ${from}`,
          'To: contact@brand.com',
          'Subject: x',
          `Date: ${date}`,
          'Content-Type: text/html',
          '',
          html,
        ].join('\r\n'),
      ),
    );
  const messages = [
    await at('noreply@mail.medium.com', 'Welcome', 'Mon, 2 Nov 2026 10:00:00 +0000'),
    await at(
      'hello@other.com',
      '<a href="https://github.com/verify/9">v</a>',
      'Mon, 2 Nov 2026 11:00:00 +0000',
    ),
    await at('news@unrelated.com', 'Promo', 'Mon, 2 Nov 2026 12:00:00 +0000'),
  ];
  assert.deepEqual(
    platformMessages(messages, 'https://medium.com').map((m) => m.from),
    ['noreply@mail.medium.com'],
  );
  assert.deepEqual(
    platformMessages(messages, 'https://github.com').map((m) => m.from),
    ['hello@other.com'],
  );
});

test('verification links are limited to the platform and ranked by intent', async () => {
  const message = await normalizeMessage(
    '1',
    raw(
      'contact@brand.com',
      `<a href="https://example-platform.com/help">Help</a>
       <a href="https://tracker.mailer.net/c/abc">Tracked</a>
       <a href="https://accounts.example-platform.com/verify?token=abc">Verify</a>
       <a href="https://example-platform.com/unsubscribe">Unsubscribe</a>`,
    ),
  );
  assert.deepEqual(message.to, ['contact@brand.com']);
  assert.equal(message.subject, 'Confirm your account');
  assert.deepEqual(verificationLinks(message, 'https://www.example-platform.com'), [
    'https://accounts.example-platform.com/verify?token=abc',
  ]);
});

test('gmail_api signs a delegated read-only JWT and searches the alias across folders', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const secret = JSON.stringify({
    type: 'service_account',
    client_email: 'reader@project.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });
  assert.equal(parseServiceAccount(secret).client_email, 'reader@project.iam.gserviceaccount.com');
  const calls = [];
  const network = {
    request: async (url, options) => {
      calls.push({ url, options });
      const json = (data, status = 200) => ({ status, headers: {}, body: JSON.stringify(data) });
      if (url === 'https://oauth2.googleapis.com/token') {
        const assertion = new URLSearchParams(options.body).get('assertion');
        const [header, claims, signature] = assertion.split('.');
        const ok = createVerify('RSA-SHA256')
          .update(`${header}.${claims}`)
          .verify(publicKey, Buffer.from(signature, 'base64url'));
        assert.equal(ok, true);
        const body = JSON.parse(Buffer.from(claims, 'base64url'));
        assert.equal(body.sub, 'inbox@brand.com');
        assert.equal(body.scope, 'https://www.googleapis.com/auth/gmail.readonly');
        return json({ access_token: 'at-1', expires_in: 3600 });
      }
      assert.equal(options.headers.Authorization, 'Bearer at-1');
      if (url.endsWith('/profile')) return json({ emailAddress: 'inbox@brand.com' });
      if (url.includes('/messages?')) {
        const q = new URL(url).searchParams.get('q');
        assert.match(q, /in:anywhere/);
        assert.match(q, /to:contact@site1\.com/);
        return json({ messages: [{ id: 'm1' }] });
      }
      return json({
        raw: raw('contact@site1.com', '<a href="https://github.com/verify/1">Go</a>').toString(
          'base64url',
        ),
      });
    },
  };
  const client = createMail({ network }).client(
    { provider: 'gmail_api', address: 'inbox@brand.com' },
    secret,
  );
  await client.test();
  const found = await client.search({ to: 'contact@site1.com', since: Date.now() - 1000 });
  assert.equal(found.length, 1);
  assert.deepEqual(verificationLinks(found[0], 'https://github.com'), [
    'https://github.com/verify/1',
  ]);
  assert.equal(calls.filter((c) => c.url.includes('/token')).length, 1, 'token is cached');
});

test('gmail_api reports missing delegation as an operator action', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const network = { request: async () => ({ status: 401, headers: {}, body: '{}' }) };
  const client = createMail({ network }).client(
    { provider: 'gmail_api', address: 'inbox@brand.com' },
    JSON.stringify({
      type: 'service_account',
      client_email: 'x@y.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    }),
  );
  await assert.rejects(client.test(), (error) => error.action && /delegation/.test(error.message));
});

test('imap connects over TLS on 993, searches inbox and junk, and skips old mail', async () => {
  const seen = {};
  const now = Date.now();
  class FakeImap {
    constructor(options) {
      seen.options = options;
    }
    on() {}
    async connect() {}
    async mailboxOpen() {}
    async list() {
      return [{ path: '[Gmail]/Spam', specialUse: '\\Junk' }];
    }
    async getMailboxLock(folder) {
      this.folder = folder;
      return { release() {} };
    }
    async search(query) {
      seen.query = query;
      return this.folder === 'INBOX' ? [1, 2] : [3];
    }
    async *fetch(uids) {
      for (const uid of uids)
        yield {
          uid,
          internalDate: new Date(uid === 1 ? now - 7 * 86400000 : now),
          source: raw('contact@brand.com', `<a href="https://medium.com/m/verify/${uid}">x</a>`),
        };
    }
    async logout() {
      seen.logout = (seen.logout ?? 0) + 1;
    }
  }
  const client = createMail({ ImapClass: FakeImap, lookup }).client(
    { provider: 'imap', address: 'contact@brand.com', imap_host: 'imap.gmail.com' },
    'app-password',
  );
  const found = await client.search({ to: 'contact@brand.com', since: now - 60000 });
  assert.equal(seen.options.port, 993);
  assert.equal(seen.options.secure, true);
  assert.equal(seen.query.to, 'contact@brand.com');
  assert.deepEqual(found.map((m) => m.id).sort(), ['INBOX:2', '[Gmail]/Spam:3']);
  assert.equal(seen.logout, 1);
});

test('imap refuses hosts that resolve to private networks', async () => {
  const client = createMail({
    ImapClass: class {},
    lookup: async () => [{ address: '10.0.0.5', family: 4 }],
  }).client({ provider: 'imap', address: 'a@b.com', imap_host: 'mail.internal-corp.com' }, 'x');
  await assert.rejects(client.test(), /công khai/);
});
