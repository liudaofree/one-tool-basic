import { validateBusinessProfile } from './field-mapping';
import { AI_LOCAL_TOOLS } from './ai-local-tools';
export interface FieldProfile {
  id: string;
  name: string;
  fields: { path: string; label: string }[];
}

export interface LocalPlugin {
  name: string;
  mount(container: HTMLElement, showToast: (message: string) => void): void;
  fieldProfiles?: FieldProfile[];
  aiTools?: { type: string; function: { name: string; description: string; parameters: object } }[];
  runAiTool?(name: string, args: Record<string, unknown>): Promise<unknown> | unknown;
}

export interface InstalledPlugin { id: string; version: string; plugin: LocalPlugin }
type PluginPackage = { manifest: { id: string; version: string; apiVersion: number }; code: string; signature: string };

const LEGACY_KEY = 'one-tool-private-plugin';
const KEY_PREFIX = 'one-tool-plugin:';
const PUBLIC_KEY = '7Dzq9v8yGm6ttZFjrJuiT6npL4Lyzj4MzDvh0jjxMig=';
const installed = new Map<string, InstalledPlugin>();
let loadPromise: Promise<void> | null = null;
const bytes = (base64: string) => Uint8Array.from(atob(base64), char => char.charCodeAt(0));

async function verifyAndLoad(raw: string): Promise<InstalledPlugin> {
  const pkg = JSON.parse(raw) as PluginPackage;
  if (!pkg?.manifest || !/^[\w.-]{1,80}$/.test(pkg.manifest.id) || pkg.manifest.apiVersion !== 2 ||
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
        (plugin.aiTools && (!Array.isArray(plugin.aiTools) || typeof plugin.runAiTool !== 'function')) ||
        (plugin.fieldProfiles && !Array.isArray(plugin.fieldProfiles))) {
      throw new Error('插件缺少必要接口');
    }
    plugin.fieldProfiles?.forEach(validateBusinessProfile);
    return { id: pkg.manifest.id, version: pkg.manifest.version, plugin };
  } finally { URL.revokeObjectURL(url); }
}

function checkToolNames(candidate: InstalledPlugin) {
  const names = new Set<string>(AI_LOCAL_TOOLS.map(tool => tool.function.name));
  for (const item of getPlugins()) {
    if (item.id === candidate.id) continue;
    for (const tool of item.plugin.aiTools || []) names.add(tool.function.name);
  }
  for (const tool of candidate.plugin.aiTools || []) {
    if (names.has(tool.function.name)) throw new Error(`AI 工具名与其他插件冲突：${tool.function.name}`);
    names.add(tool.function.name);
  }
}

export function getPlugins(): InstalledPlugin[] { return [...installed.values()]; }
export function getPluginForTool(name: string): InstalledPlugin | undefined {
  return getPlugins().find(item => item.plugin.aiTools?.some(tool => tool.function.name === name));
}

export function loadPlugins(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => !!key && key.startsWith(KEY_PREFIX));
    if (localStorage.getItem(LEGACY_KEY) && !keys.includes(`${KEY_PREFIX}one-tool-private-plugin`)) keys.push(LEGACY_KEY);
    const errors: string[] = [];
    for (const key of keys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const item = await verifyAndLoad(raw);
        if (key !== LEGACY_KEY && key !== `${KEY_PREFIX}${item.id}`) throw new Error('插件 ID 与保存位置不一致');
        checkToolNames(item);
        installed.set(item.id, item);
        if (key === LEGACY_KEY) {
          localStorage.setItem(`${KEY_PREFIX}${item.id}`, raw);
          localStorage.removeItem(LEGACY_KEY);
        }
      } catch (error) { errors.push(`${key}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (errors.length) throw new Error(errors.join('；'));
  })();
  return loadPromise;
}

export async function installPlugin(raw: string): Promise<InstalledPlugin> {
  await loadPlugins().catch(() => undefined);
  const item = await verifyAndLoad(raw);
  checkToolNames(item);
  localStorage.setItem(`${KEY_PREFIX}${item.id}`, raw);
  installed.set(item.id, item);
  return item;
}

export function removePlugin(id: string): void {
  localStorage.removeItem(`${KEY_PREFIX}${id}`);
  installed.delete(id);
}
