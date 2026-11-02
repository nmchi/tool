import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import { AppError, hostKey, publicUrl, websiteKey } from './urls.js';
import { RemoteError, checkApiResponse, retryDelay } from './network.js';

const plain = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const sameWebsite = (value, website) => {
  try {
    return websiteKey(value) === websiteKey(website);
  } catch {
    return false;
  }
};

export function payloadFor(project, connector) {
  if (connector === 'github')
    return { name: project.name, bio: project.description.slice(0, 160), blog: project.website };
  if (connector === 'gitlab')
    return {
      name: project.name,
      bio: project.description.slice(0, 255),
      website_url: project.website,
    };
  return {
    name: project.name,
    username: project.username,
    website: project.website,
    description: project.description,
    logo_url: project.logo_url,
    email: project.email,
  };
}

export function analyzeHtml(html, url, project, headers = {}) {
  const $ = cheerio.load(html);
  const title = $('title').text().replace(/\s+/g, ' ').trim().slice(0, 250);
  const blocked =
    /just a moment|attention required|access denied|verify you are human|checking your browser/i.test(
      title,
    ) || $('#challenge-form, #cf-challenge-running').length > 0;
  const login = $('input[type="password"]').length > 0 && /log.?in|sign.?in|đăng nhập/i.test(title);
  $('script,style,noscript,nav,footer').remove();
  const text = plain($('body').text());
  const name = plain(project.name);
  const identity_match = name.length >= 2 && text.includes(name);
  const backlink = $('a[href]')
    .toArray()
    .some((a) => {
      try {
        return sameWebsite(new URL($(a).attr('href'), url).href, project.website);
      } catch {
        return false;
      }
    });
  const robots = `${$('meta[name="robots"]').attr('content') || ''} ${headers['x-robots-tag'] || ''}`;
  const indexability = /noindex/i.test(robots) ? 'noindex' : 'unknown';
  const evidence = {
    url,
    title,
    identity_match,
    backlink,
    indexability,
    content_hash: createHash('sha256').update(html).digest('hex'),
    checked_at: Date.now(),
    method: 'public_html',
  };
  if (blocked || login)
    return {
      ...evidence,
      status: 'unknown',
      reason: blocked
        ? 'Trang xác minh/chống bot; chưa xác định được hồ sơ.'
        : 'Đang thấy trang đăng nhập; chưa xác định được hồ sơ công khai.',
    };
  if (!identity_match || !backlink)
    return {
      ...evidence,
      status: 'needs_review',
      reason: !identity_match
        ? 'Chưa tìm thấy tên thương hiệu trong nội dung công khai.'
        : 'Chưa tìm thấy liên kết trực tiếp về website.',
    };
  return {
    ...evidence,
    status: 'healthy',
    reason: 'Đã thấy tên thương hiệu và liên kết trực tiếp về website trong trang công khai.',
  };
}

export class Connectors {
  constructor(network) {
    this.network = network;
  }
  api(platform, endpoint, options = {}) {
    const base = platform.connector === 'github' ? 'https://api.github.com' : platform.origin;
    const url = new URL(endpoint, base);
    return this.network.request(url.href, {
      ...options,
      allowedHosts: [url.hostname],
      headers: { Accept: 'application/json', ...options.headers },
    });
  }
  async identity(platform, token) {
    if (!['github', 'gitlab'].includes(platform.connector))
      throw new AppError('Nền tảng này dùng quy trình đăng ký có hỗ trợ.');
    const endpoint = platform.connector === 'github' ? '/user' : '/api/v4/user';
    const response = await this.api(platform, endpoint, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = checkApiResponse(response);
    const username = platform.connector === 'github' ? data.login : data.username;
    const profile_url = platform.connector === 'github' ? data.html_url : data.web_url;
    if (
      !data.id ||
      typeof username !== 'string' ||
      typeof profile_url !== 'string' ||
      hostKey(publicUrl(profile_url).hostname) !== hostKey(new URL(platform.origin).hostname)
    )
      throw new RemoteError('API chưa trả đủ thông tin nhận diện tài khoản.', { action: true });
    return { remote_id: String(data.id), username, profile_url, data };
  }

  async sync(project, platform, account, token) {
    const identity = await this.identity(platform, token);
    if (identity.remote_id !== account.remote_id)
      throw new RemoteError('Token hiện trỏ đến tài khoản khác. Cần kết nối lại đúng tài khoản.', {
        action: true,
      });
    const payload = payloadFor(project, platform.connector);
    const matches = Object.entries(payload).every(
      ([key, value]) => String(identity.data[key] ?? '') === value,
    );
    if (!matches) {
      const response = await this.api(
        platform,
        platform.connector === 'github' ? '/user' : '/api/v4/user',
        {
          method: platform.connector === 'github' ? 'PATCH' : 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      checkApiResponse(response);
    }
    return { url: identity.profile_url, username: identity.username, changed: !matches };
  }

  async verify(project, platform, profileUrl) {
    if (platform.connector === 'github') {
      const username = new URL(profileUrl).pathname.split('/').filter(Boolean);
      if (username.length !== 1 || !/^[a-z\d-]+$/i.test(username[0]))
        return {
          status: 'needs_review',
          reason: 'URL GitHub cần trỏ đến hồ sơ người dùng.',
          url: profileUrl,
          checked_at: Date.now(),
        };
      const response = await this.api(platform, `/users/${encodeURIComponent(username[0])}`);
      if ([404, 410].includes(response.status))
        return {
          status: 'unavailable',
          reason: `API công khai trả HTTP ${response.status}. Cần kiểm tra hồ sơ.`,
          http_status: response.status,
          url: profileUrl,
          checked_at: Date.now(),
        };
      const user = checkApiResponse(response);
      const identity_match =
        plain(user.name) === plain(project.name) &&
        String(user.login).toLowerCase() === username[0].toLowerCase();
      const backlink = sameWebsite(user.blog, project.website);
      return {
        status: identity_match && backlink ? 'healthy' : 'needs_review',
        identity_match,
        backlink,
        url: profileUrl,
        title: user.name || user.login,
        method: 'github_public_api',
        http_status: response.status,
        indexability: 'unknown',
        checked_at: Date.now(),
        reason:
          identity_match && backlink
            ? 'API công khai xác nhận đúng tên thương hiệu và website.'
            : 'Tên thương hiệu hoặc website trong hồ sơ chưa khớp.',
      };
    }
    let current = publicUrl(profileUrl);
    const hostname = hostKey(new URL(platform.origin).hostname);
    for (let hop = 0; hop < 4; hop++) {
      if (hostKey(current.hostname) !== hostname)
        throw new RemoteError('Hồ sơ chuyển sang nền tảng khác; cần kiểm tra URL.', {
          action: true,
        });
      const response = await this.network.request(current.href, {
        allowedHosts: [current.hostname],
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.headers.location) break;
        current = publicUrl(new URL(response.headers.location, current).href);
        continue;
      }
      if ([404, 410].includes(response.status))
        return {
          status: 'unavailable',
          reason: `Trang công khai trả HTTP ${response.status}. Cần kiểm tra, chưa kết luận tài khoản bị xóa.`,
          url: current.href,
          http_status: response.status,
          checked_at: Date.now(),
        };
      if (response.status === 429)
        throw new RemoteError('Nền tảng giới hạn tốc độ.', {
          retryable: true,
          delay: retryDelay(response),
        });
      if (response.status >= 500) throw new RemoteError('Nền tảng đang lỗi.', { retryable: true });
      if (response.status !== 200)
        return {
          status: 'unknown',
          reason: `HTTP ${response.status}: chưa xác minh được hồ sơ công khai.`,
          url: current.href,
          http_status: response.status,
          checked_at: Date.now(),
        };
      if (!/text\/html|application\/xhtml\+xml/i.test(response.headers['content-type'] || ''))
        return {
          status: 'unknown',
          reason: 'Phản hồi không phải trang HTML; cần bộ tích hợp phù hợp.',
          url: current.href,
          checked_at: Date.now(),
        };
      return {
        ...analyzeHtml(response.body, current.href, project, response.headers),
        http_status: response.status,
      };
    }
    return {
      status: 'unknown',
      reason: 'Chuyển hướng quá nhiều hoặc thiếu đích chuyển hướng.',
      url: current.href,
      checked_at: Date.now(),
    };
  }
}
