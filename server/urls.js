import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

export class AppError extends Error {
  constructor(message, status = 400, code = 'validation') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function publicUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AppError('URL không hợp lệ.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !url.hostname.includes('.') ||
    isIP(url.hostname.replace(/[\[\]]/g, '')) ||
    /(^|\.)(localhost|local|internal|test|invalid|onion)$/.test(url.hostname) ||
    url.hostname.endsWith('.')
  ) {
    throw new AppError(
      'Chỉ chấp nhận URL công khai HTTP/HTTPS, không có thông tin đăng nhập hoặc cổng riêng.',
    );
  }
  return url;
}

export function normalizedUrl(value) {
  const url = publicUrl(value.trim());
  // Hash-routed applications may encode the actual profile identity here.
  if (!/^#!?\//.test(url.hash)) url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|locale$|lang$)/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}

// Canonical mailbox identity: "+tag" suffixes and Gmail dots reach the same inbox, so
// they must not count as different addresses when each website needs its own email.
export function emailKey(value) {
  const [local, domain] = String(value ?? '')
    .trim()
    .toLowerCase()
    .split('@');
  if (!local || !domain) return '';
  const host = domain === 'googlemail.com' ? 'gmail.com' : domain;
  let name = local.split('+')[0];
  if (host === 'gmail.com') name = name.replaceAll('.', '');
  return `${name}@${host}`;
}
export const isGmail = (value) => /@(gmail|googlemail).com$/i.test(String(value ?? '').trim());

export const hostKey = (hostname) => hostname.toLowerCase().replace(/^www\./, '');
export const websiteKey = (value) => hostKey(publicUrl(value).hostname);

export async function assertPublicDestination(value, lookup = dns.lookup) {
  const url = publicUrl(value);
  let answers;
  try {
    answers = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new AppError('Chưa phân giải được DNS của nền tảng.', 502, 'network');
  }
  if (
    !answers.length ||
    answers.some(({ address }) => {
      try {
        return ipaddr.process(address).range() !== 'unicast';
      } catch {
        return true;
      }
    })
  )
    throw new AppError(
      'Đích truy cập không phải địa chỉ Internet công khai.',
      400,
      'unsafe_destination',
    );
  return answers;
}

export function matchesPlatform(value, platform) {
  const url = publicUrl(value);
  return hostKey(url.hostname) === hostKey(new URL(platform.origin).hostname);
}

export function safeCsv(rows) {
  const cell = (value) => {
    let str = String(value ?? '');
    if (/^[\s]*[=+\-@\t\r]/.test(str)) str = `'${str}`;
    return `"${str.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n');
}
