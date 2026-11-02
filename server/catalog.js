import { hostKey, normalizedUrl } from './urls.js';

export const SEEDS = [
  {
    id: 'github',
    name: 'GitHub',
    origin: 'https://github.com',
    connector: 'github',
    registration_url: 'https://github.com/signup',
    profile_template: 'https://github.com/{username}',
    category: 'developer',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    origin: 'https://gitlab.com',
    connector: 'gitlab',
    registration_url: 'https://gitlab.com/users/sign_up',
    profile_template: 'https://gitlab.com/{username}',
    category: 'developer',
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    origin: 'https://www.pinterest.com',
    connector: 'manual',
    registration_url: 'https://www.pinterest.com/business/create/',
    profile_template: 'https://www.pinterest.com/{username}/',
    category: 'social',
  },
  {
    id: 'facebook',
    name: 'Facebook',
    origin: 'https://www.facebook.com',
    connector: 'manual',
    registration_url: 'https://www.facebook.com/pages/create/',
    profile_template: 'https://www.facebook.com/{username}/',
    category: 'social',
  },
  {
    id: 'aboutme',
    name: 'about.me',
    origin: 'https://about.me',
    connector: 'manual',
    registration_url: 'https://about.me/signup',
    profile_template: 'https://about.me/{username}',
    category: 'bio',
  },
  {
    id: 'gravatar',
    name: 'Gravatar',
    origin: 'https://gravatar.com',
    connector: 'manual',
    registration_url: 'https://gravatar.com/connect/',
    profile_template: 'https://gravatar.com/{username}',
    category: 'identity',
  },
  {
    id: 'behance',
    name: 'Behance',
    origin: 'https://www.behance.net',
    connector: 'manual',
    registration_url: 'https://www.behance.net/',
    profile_template: 'https://www.behance.net/{username}',
    category: 'creative',
  },
  {
    id: 'heylink',
    name: 'HeyLink.me',
    origin: 'https://heylink.me',
    connector: 'manual',
    registration_url: 'https://heylink.me/',
    profile_template: 'https://heylink.me/{username}/',
    category: 'bio',
  },
];

// These are URL-shape hints, not claims that the platform/profile was checked.
export function classifyUrl(value) {
  let url;
  try {
    url = new URL(normalizedUrl(value));
  } catch (e) {
    return { input: value, kind: 'invalid', reason: e.message };
  }
  const path = url.pathname;
  let kind = 'unknown';
  if (
    /\/bye\b|\/redirect\b|\/out\b/i.test(path) ||
    /^(bit\.ly|zzb\.bz|pslk\.net)$/.test(hostKey(url.hostname))
  )
    kind = 'redirect';
  else if (
    /website-checker|website-reviewer|website-worth|\/report\/|\/site$/i.test(path) ||
    /^(website\.informer\.com|www\.easycounter\.com|easycounter\.com)$/.test(url.hostname)
  )
    kind = 'report';
  else if (
    /\/forum\/topic\/|\/board_topic\/|\/story\/|\/articles\/|\/bookmarks?\/|\/s\//i.test(path)
  )
    kind = 'content';
  else if (
    /\/users?\/|\/profiles?\/|\/members?\/|\/author\/|\/@|\/people\/|\/by\//i.test(path) ||
    SEEDS.some((p) => hostKey(new URL(p.origin).hostname) === hostKey(url.hostname))
  )
    kind = 'profile';
  return {
    input: value,
    url: url.toString(),
    origin: url.origin,
    host: hostKey(url.hostname),
    kind,
    reason: {
      redirect: 'Liên kết chuyển hướng; không phải hồ sơ.',
      report: 'Trang báo cáo website; không phải hồ sơ.',
      content: 'Có dạng bài đăng/tài liệu; cần xem xét.',
      profile: 'Có dạng hồ sơ; chưa kiểm tra trực tiếp.',
      unknown: 'Cần phân loại thủ công.',
    }[kind],
  };
}

export function parseImport(text) {
  const inputs = text.match(/https?:\/\/[^\s<>"\u0000-\u001f]+/gi) ?? [];
  if (inputs.length > 2000) throw new Error('Mỗi lần nhập tối đa 2.000 URL.');
  const seen = new Set();
  let duplicates = 0;
  const rows = [];
  for (const input of inputs) {
    const row = classifyUrl(input);
    if (row.url && seen.has(row.url)) {
      duplicates++;
      continue;
    }
    if (row.url) seen.add(row.url);
    rows.push(row);
  }
  return { rows, total: inputs.length, duplicates };
}
