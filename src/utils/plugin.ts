export interface LocalPlugin {
  name: string;
  mount(container: HTMLElement, showToast: (message: string) => void): void;
  aiTools?: { type: string; function: { name: string; description: string; parameters: object } }[];
  runAiTool?(name: string, args: Record<string, unknown>): Promise<unknown> | unknown;
}

const STORAGE_KEY = 'one-tool-private-plugin';
const PUBLIC_KEY = '7Dzq9v8yGm6ttZFjrJuiT6npL4Lyzj4MzDvh0jjxMig=';
type PluginPackage = { manifest: { id: string; version: string; apiVersion: number }; code: string; signature: string };
let activePlugin: LocalPlugin | null = null;

const bytes = (base64: string) => Uint8Array.from(atob(base64), char => char.charCodeAt(0));

async function verifyAndLoad(raw: string): Promise<LocalPlugin> {
  const pkg = JSON.parse(raw) as PluginPackage;
  if (typeof pkg?.manifest?.id !== 'string' || !pkg.manifest.id || pkg.manifest.apiVersion !== 2 ||
      typeof pkg.manifest.version !== 'string' || typeof pkg.code !== 'string' || typeof pkg.signature !== 'string') {
    throw new Error('插件包格式或接口版本不兼容');
  }
  const key = await crypto.subtle.importKey('raw', bytes(PUBLIC_KEY), { name: 'Ed25519' }, false, ['verify']);
  const payload = new TextEncoder().encode(`${JSON.stringify(pkg.manifest)}\n${pkg.code}`);
  if (!await crypto.subtle.verify('Ed25519', key, bytes(pkg.signature), payload)) throw new Error('插件签名校验失败');
  const url = URL.createObjectURL(new Blob([pkg.code], { type: 'text/javascript' }));
  try {
    const module = await import(/* @vite-ignore */ url) as { default?: LocalPlugin };
    const plugin = module.default;
    if (!plugin || typeof plugin.name !== 'string' || typeof plugin.mount !== 'function' ||
        (plugin.aiTools && (!Array.isArray(plugin.aiTools) || typeof plugin.runAiTool !== 'function'))) {
      throw new Error('插件缺少必要接口');
    }
    return plugin;
  } finally { URL.revokeObjectURL(url); }
}

export function getPlugin(): LocalPlugin | null { return activePlugin; }

export async function loadPlugin(): Promise<LocalPlugin | null> {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return null;
  activePlugin = await verifyAndLoad(saved);
  return activePlugin;
}

export async function installPlugin(raw: string): Promise<LocalPlugin> {
  const plugin = await verifyAndLoad(raw);
  localStorage.setItem(STORAGE_KEY, raw);
  activePlugin = plugin;
  return plugin;
}
