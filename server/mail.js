import { createSign } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import * as cheerio from 'cheerio';
import { AppError, assertPublicDestination, hostKey, publicUrl } from './urls.js';
import { RemoteError, checkApiResponse } from './network.js';

// Mailbox providers. A mailbox belongs to the workspace and can serve several projects
// (e.g. one Google Workspace inbox receiving aliases for many brand domains).
//  - imap:      Gmail/Workspace App Password (imap.gmail.com) or any other IMAPS host
//  - gmail_api: Google Workspace service account with domain-wide delegation (read-only)
//  - manual:    nothing is read; the operator opens verification links personally
export const PROVIDERS = ['imap', 'gmail_api', 'manual'];
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

const b64url = (value) => Buffer.from(value).toString('base64url');

export function parseServiceAccount(text) {
  let key;
  try {
    key = JSON.parse(text);
  } catch {
    throw new AppError('Khóa service account phải là tệp JSON tải từ Google Cloud.');
  }
  if (
    key?.type !== 'service_account' ||
    typeof key.client_email !== 'string' ||
    typeof key.private_key !== 'string' ||
    !key.private_key.includes('PRIVATE KEY')
  )
    throw new AppError('JSON không phải khóa service account hợp lệ.');
  return key;
}

function linksOf(parsed) {
  const links = new Set();
  if (parsed.html) {
    const $ = cheerio.load(parsed.html);
    $('a[href]').each((_i, a) => links.add($(a).attr('href')));
  }
  for (const match of String(parsed.text ?? '').matchAll(/https?:\/\/[^\s<>"')\]]+/g))
    links.add(match[0]);
  return [...links].filter((href) => {
    try {
      publicUrl(href);
      return true;
    } catch {
      return false;
    }
  });
}

export async function normalizeMessage(id, raw) {
  const parsed = await simpleParser(raw);
  const list = (field) => (field?.value ?? []).map((a) => a.address?.toLowerCase()).filter(Boolean);
  return {
    id: String(id),
    from: list(parsed.from)[0] ?? '',
    to: [...list(parsed.to), ...list(parsed.cc)],
    subject: parsed.subject ?? '',
    date: parsed.date ? parsed.date.getTime() : 0,
    text: String(parsed.text ?? '').slice(0, 20000),
    links: linksOf(parsed),
  };
}

const onPlatform = (host, platformHost) =>
  host === platformHost || host.endsWith(`.${platformHost}`);

// Every profile of a website registers with the website's single email, so mail is tied to
// a platform by its sender domain or by links pointing at the platform, newest first.
export function platformMessages(messages, platformOrigin) {
  const platformHost = hostKey(new URL(platformOrigin).hostname);
  return messages
    .filter(
      (m) =>
        onPlatform(hostKey(m.from.split('@')[1] ?? ''), platformHost) ||
        verificationLinks(m, platformOrigin).length > 0,
    )
    .sort((a, b) => b.date - a.date);
}

// Links in a verification mail that point at the platform itself (or a subdomain such as
// accounts.example.com), most likely confirmation links first. Third-party click trackers
// are not followed automatically; the operator gets the mail instead.
export function verificationLinks(message, platformOrigin) {
  const platformHost = hostKey(new URL(platformOrigin).hostname);
  const score = (href) =>
    /verif|confirm|activat|validat|token|signup|register/i.test(href) ? 0 : 1;
  return message.links
    .filter((href) => onPlatform(hostKey(new URL(href).hostname), platformHost))
    .filter((href) => !/unsubscribe|privacy|terms|help|support/i.test(href))
    .sort((a, b) => score(a) - score(b));
}

export function createMail({ network, ImapClass = ImapFlow, lookup } = {}) {
  const imap = (mailbox, secret) => ({
    async open() {
      publicUrl(`https://${mailbox.imap_host}`);
      await assertPublicDestination(`https://${mailbox.imap_host}`, lookup);
      const client = new ImapClass({
        host: mailbox.imap_host,
        port: 993,
        secure: true,
        auth: { user: mailbox.address, pass: secret },
        logger: false,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 60000,
      });
      // ImapFlow emits socket errors as events; never let one crash the process.
      client.on?.('error', () => {});
      try {
        await client.connect();
      } catch (error) {
        if (error?.authenticationFailed || /auth/i.test(String(error?.responseText ?? '')))
          throw new RemoteError(
            'Hộp thư từ chối đăng nhập. Kiểm tra địa chỉ và App Password (cần bật xác minh 2 bước).',
            { action: true },
          );
        throw new RemoteError('Không kết nối được máy chủ IMAP; sẽ thử lại.', {
          retryable: true,
        });
      }
      return client;
    },
    async test() {
      const client = await this.open();
      try {
        await client.mailboxOpen('INBOX', { readOnly: true });
      } finally {
        await client.logout().catch(() => {});
      }
    },
    async search({ to, since, limit = 10 }) {
      const client = await this.open();
      const found = [];
      try {
        const folders = ['INBOX'];
        // Verification mail is sometimes filed as spam.
        const junk = (await client.list().catch(() => [])).find((f) => f.specialUse === '\\Junk');
        if (junk) folders.push(junk.path);
        for (const folder of folders) {
          const lock = await client.getMailboxLock(folder, { readOnly: true });
          try {
            const query = { since: new Date(since - 86400000) };
            if (to) query.to = to;
            const uids = ((await client.search(query, { uid: true })) || []).slice(-limit);
            if (!uids.length) continue;
            for await (const msg of client.fetch(
              uids,
              { source: true, internalDate: true },
              { uid: true },
            )) {
              if (msg.internalDate && msg.internalDate.getTime() < since - 60000) continue;
              found.push(await normalizeMessage(`${folder}:${msg.uid}`, msg.source));
            }
          } finally {
            lock.release();
          }
        }
      } finally {
        await client.logout().catch(() => {});
      }
      return found.sort((a, b) => b.date - a.date).slice(0, limit);
    },
  });

  const gmailApi = (mailbox, secret) => {
    const key = parseServiceAccount(secret);
    let cached = null;
    const token = async () => {
      if (cached && cached.expires > Date.now() + 60000) return cached.value;
      const now = Math.floor(Date.now() / 1000);
      const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
        JSON.stringify({
          iss: key.client_email,
          sub: mailbox.address,
          scope: GMAIL_SCOPE,
          aud: TOKEN_URL,
          iat: now,
          exp: now + 3600,
        }),
      )}`;
      const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key);
      const response = await network.request(TOKEN_URL, {
        method: 'POST',
        allowedHosts: ['oauth2.googleapis.com'],
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: `${unsigned}.${signature.toString('base64url')}`,
        }).toString(),
      });
      if ([400, 401, 403].includes(response.status))
        throw new RemoteError(
          'Google từ chối service account. Kiểm tra domain-wide delegation cho client ID với phạm vi gmail.readonly và địa chỉ hộp thư thuộc Workspace.',
          { action: true },
        );
      const data = checkApiResponse(response);
      cached = { value: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 };
      return cached.value;
    };
    const get = async (path) =>
      checkApiResponse(
        await network.request(`${GMAIL}${path}`, {
          allowedHosts: ['gmail.googleapis.com'],
          headers: { Authorization: `Bearer ${await token()}`, Accept: 'application/json' },
        }),
      );
    return {
      async test() {
        const profile = await get('/profile');
        if (String(profile.emailAddress).toLowerCase() !== mailbox.address.toLowerCase())
          throw new RemoteError('Google trả về hộp thư khác với địa chỉ đã nhập.', {
            action: true,
          });
      },
      async search({ to, since, limit = 10 }) {
        const q = [
          'in:anywhere',
          `after:${Math.floor((since - 60000) / 1000)}`,
          to ? `{to:${to} deliveredto:${to}}` : '',
        ]
          .filter(Boolean)
          .join(' ');
        const list = await get(`/messages?maxResults=${limit}&q=${encodeURIComponent(q)}`);
        const found = [];
        for (const { id } of list.messages ?? []) {
          const msg = await get(`/messages/${encodeURIComponent(id)}?format=raw`);
          found.push(await normalizeMessage(id, Buffer.from(msg.raw, 'base64url')));
        }
        return found.sort((a, b) => b.date - a.date);
      },
    };
  };

  return {
    client(mailbox, secret) {
      if (mailbox.provider === 'imap') return imap(mailbox, secret);
      if (mailbox.provider === 'gmail_api') return gmailApi(mailbox, secret);
      return {
        async test() {},
        async search() {
          return [];
        },
      };
    },
  };
}
