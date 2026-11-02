export const labels: Record<string, string> = {
  queued: 'Trong hàng đợi',
  running: 'Đang xử lý',
  retry: 'Chờ thử lại',
  action_required: 'Cần thao tác',
  succeeded: 'Đã xác minh',
  failed: 'Gặp lỗi',
  cancelled: 'Đã hủy',
  skipped: 'Bỏ qua',
  healthy: 'Đang hoạt động',
  unverified: 'Chưa kiểm tra',
  needs_review: 'Cần xem xét',
  unknown: 'Chưa xác định',
  unavailable: 'Không truy cập được',
  active: 'Đang mở',
  paused: 'Tạm dừng',
};
export const kindLabel = {
  prepare: 'Chuẩn bị hồ sơ',
  verify: 'Kiểm tra hồ sơ',
  sync: 'Cập nhật qua API',
};
export const categoryLabel: Record<string, string> = {
  social: 'Mạng xã hội',
  developer: 'Cộng đồng phát triển',
  bio: 'Trang giới thiệu',
  identity: 'Định danh',
  creative: 'Sáng tạo',
  other: 'Chưa phân loại',
};
export const fmt = (value: number | null | undefined) =>
  value
    ? new Intl.DateTimeFormat('vi-VN', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Asia/Ho_Chi_Minh',
      }).format(value)
    : '—';
export const domain = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
export const matches = (q: string, ...values: (string | undefined)[]) =>
  !q || values.some((v) => v?.toLocaleLowerCase('vi').includes(q.toLocaleLowerCase('vi')));
export const cls = (...values: (string | false | undefined)[]) => values.filter(Boolean).join(' ');
