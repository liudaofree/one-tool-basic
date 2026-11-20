export const UPDATE_PROXY_KEY = 'one-tool:update-proxy';

export function normalizeUpdateProxy(value: string): string {
  const proxy = value.trim();
  if (!proxy) return '';
  let url: URL;
  try { url = new URL(proxy); } catch { throw new Error('代理地址格式无效，例如 http://127.0.0.1:7890'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('请填写不含账号密码的代理地址和端口，例如 http://127.0.0.1:7890');
  }
  return proxy;
}

export function updateProxyOptions(): { proxy: string } | undefined {
  const proxy = normalizeUpdateProxy(localStorage.getItem(UPDATE_PROXY_KEY) || '');
  return proxy ? { proxy } : undefined;
}
