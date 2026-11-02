import { fetch, EnvHttpProxyAgent, Agent } from 'undici';
import { assertPublicDestination, AppError } from './urls.js';

export class RemoteError extends AppError {
  constructor(message, { retryable = false, delay = 0, action = false, status = 502 } = {}) {
    super(message, status, 'remote');
    this.retryable = retryable;
    this.delay = delay;
    this.action = action;
  }
}

export function retryDelay(response) {
  const value = response.headers['retry-after'];
  const seconds = Number(value);
  let delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  const reset = Number(response.headers['x-ratelimit-reset']);
  if (!Number.isFinite(delay) && reset > 0) delay = reset * 1000 - Date.now();
  return Math.min(3600000, Math.max(10000, Number.isFinite(delay) ? delay : 60000));
}

export function checkApiResponse(response) {
  if (
    response.status === 429 ||
    (response.status === 403 && response.headers['x-ratelimit-remaining'] === '0')
  )
    throw new RemoteError('Nền tảng giới hạn tốc độ; đã lên lịch thử lại.', {
      retryable: true,
      delay: retryDelay(response),
    });
  if ([401, 403].includes(response.status))
    throw new RemoteError(
      'Không đủ quyền hoặc cần xác minh tài khoản. Kiểm tra token và quyền trên nền tảng.',
      { action: true },
    );
  if (response.status >= 500)
    throw new RemoteError('Nền tảng đang lỗi; sẽ thử lại.', { retryable: true });
  if (response.status < 200 || response.status >= 300)
    throw new RemoteError(`API trả HTTP ${response.status}; cần kiểm tra cấu hình tài khoản.`, {
      action: true,
    });
  try {
    return JSON.parse(response.body);
  } catch {
    throw new RemoteError('API trả định dạng khác dự kiến; cần kiểm tra bộ tích hợp.', {
      action: true,
    });
  }
}

export function createNetwork({ lookup, fetchImpl = fetch } = {}) {
  const proxyConfigured = !!(
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy
  );
  const proxyAgent = proxyConfigured ? new EnvHttpProxyAgent() : null;
  return {
    async request(value, { method = 'GET', headers = {}, body, allowedHosts, signal } = {}) {
      const url = new URL(value);
      if (!allowedHosts?.includes(url.hostname))
        throw new AppError(
          'Đích truy cập nằm ngoài bộ tích hợp được chọn.',
          400,
          'unsafe_destination',
        );
      if (headers.Authorization && url.protocol !== 'https:')
        throw new AppError('Thông tin đăng nhập chỉ được gửi qua HTTPS.');
      const answers = await assertPublicDestination(value, lookup);
      // Pin direct connections to the addresses checked above. Proxy traffic keeps
      // the inherited proxy and its destination/DNS enforcement.
      const directAgent = proxyAgent
        ? null
        : new Agent({
            connect: {
              lookup: (_host, options, callback) => {
                const selected = options.family
                  ? answers.filter((a) => a.family === options.family)
                  : answers;
                if (!selected.length) return callback(new Error('No compatible public address'));
                if (options.all) callback(null, selected);
                else callback(null, selected[0].address, selected[0].family);
              },
            },
          });
      try {
        const response = await fetchImpl(value, {
          method,
          headers: { 'User-Agent': 'EntityWorkspace/0.1 (profile management)', ...headers },
          body,
          dispatcher: proxyAgent ?? directAgent,
          redirect: 'manual',
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
            : AbortSignal.timeout(15000),
        });
        const length = Number(response.headers.get('content-length') || 0);
        if (length > 2 * 1024 * 1024) {
          await response.body?.cancel();
          throw new RemoteError('Phản hồi vượt giới hạn 2 MB.', { action: true });
        }
        let bytes = 0;
        const chunks = [];
        if (response.body)
          for await (const chunk of response.body) {
            bytes += chunk.length;
            if (bytes > 2 * 1024 * 1024)
              throw new RemoteError('Phản hồi vượt giới hạn 2 MB.', { action: true });
            chunks.push(Buffer.from(chunk));
          }
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: Buffer.concat(chunks).toString('utf8'),
        };
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new RemoteError(
          'Không truy cập được nền tảng. Kiểm tra mạng/proxy; tác vụ sẽ thử lại có giới hạn.',
          { retryable: true },
        );
      } finally {
        await directAgent?.close();
      }
    },
    async close() {
      await proxyAgent?.close();
    },
  };
}
