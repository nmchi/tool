export async function api<T = unknown>(url: string, options: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem('entity-access-token');
  const response = await fetch(`/api${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Entity-Client': 'workspace',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Không kết nối được máy chủ.' }));
    const error = new Error(body.error || 'Yêu cầu thất bại.') as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return response.json();
}
export async function downloadReport(kind: 'profiles' | 'jobs') {
  const token = sessionStorage.getItem('entity-access-token');
  const response = await fetch(`/api/export/${kind}.csv`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error('Chưa xuất được báo cáo. Hãy kiểm tra kết nối và mã truy cập.');
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `entity-${kind}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
