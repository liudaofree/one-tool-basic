import { cookiesForUrl, normalizeDomain, parseSetCookie, validateCookie } from './http-cookies';
import type { HistoryItem, SavedRequest, Environment } from '../types/http';

const STORAGE_KEYS = {
  HISTORY: 'onetool_http_history',
  SAVED: 'onetool_http_saved',
  ENVIRONMENTS: 'onetool_http_environments',
  ACTIVE_ENV: 'onetool_http_active_env_id',
};

export const FIXED_ENVIRONMENTS: Environment[] = [
  {
    id: 'env_dev',
    name: '开发环境 (Dev)',
    variables: {
      baseUrl: 'http://localhost:8080',
      token: '',
    },
  },
  {
    id: 'env_prod',
    name: '生产环境 (Prod)',
    variables: {
      baseUrl: 'https://api.example.com',
      token: '',
    },
  },
];

export const Storage = {
  getHistory(): HistoryItem[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.HISTORY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  addHistory(item: Omit<HistoryItem, 'id' | 'timestamp'>): HistoryItem {
    const history = this.getHistory();
    const newItem: HistoryItem = {
      ...item,
      id: 'hist_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      timestamp: Date.now(),
    };
    // Keep max 50 items
    history.unshift(newItem);
    if (history.length > 50) {
      history.pop();
    }
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
    return newItem;
  },

  clearHistory(): void {
    localStorage.removeItem(STORAGE_KEYS.HISTORY);
  },

  deleteHistoryItem(id: string): void {
    const history = this.getHistory().filter((h) => h.id !== id);
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
  },

  getSavedRequests(): SavedRequest[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SAVED);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  saveRequest(name: string, payload: any, group: string = '默认分组'): SavedRequest {
    const saved = this.getSavedRequests();
    const item: SavedRequest = {
      id: 'save_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      name: name.trim() || '未命名接口',
      group: group.trim() || '默认分组',
      createdAt: Date.now(),
      payload,
    };
    saved.unshift(item);
    localStorage.setItem(STORAGE_KEYS.SAVED, JSON.stringify(saved));
    return item;
  },

  updateSavedRequest(id: string, updates: Partial<SavedRequest>): void {
    const saved = this.getSavedRequests().map((s) => {
      if (s.id === id) {
        return { ...s, ...updates };
      }
      return s;
    });
    localStorage.setItem(STORAGE_KEYS.SAVED, JSON.stringify(saved));
  },

  deleteSavedRequest(id: string): void {
    const saved = this.getSavedRequests().filter((s) => s.id !== id);
    localStorage.setItem(STORAGE_KEYS.SAVED, JSON.stringify(saved));
  },

  getSavedGroups(): string[] {
    const saved = this.getSavedRequests();
    const groupSet = new Set<string>();
    groupSet.add('默认分组');
    saved.forEach((s) => {
      if (s.group?.trim()) {
        groupSet.add(s.group.trim());
      }
    });
    return Array.from(groupSet);
  },

  getEnvironments(): Environment[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.ENVIRONMENTS);
      if (!data) {
        localStorage.setItem(STORAGE_KEYS.ENVIRONMENTS, JSON.stringify(FIXED_ENVIRONMENTS));
        return FIXED_ENVIRONMENTS;
      }
      const parsed: Environment[] = JSON.parse(data);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return FIXED_ENVIRONMENTS;
      }
      return parsed;
    } catch {
      return FIXED_ENVIRONMENTS;
    }
  },

  saveEnvironments(envs: Environment[]): void {
    localStorage.setItem(STORAGE_KEYS.ENVIRONMENTS, JSON.stringify(envs));
  },

  addEnvironment(name: string): Environment {
    const envs = this.getEnvironments();
    const newEnv: Environment = {
      id: 'env_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      name: name.trim() || '新环境',
      variables: {},
    };
    envs.push(newEnv);
    this.saveEnvironments(envs);
    return newEnv;
  },

  deleteEnvironment(envId: string): void {
    let envs = this.getEnvironments();
    envs = envs.filter((e) => e.id !== envId);
    if (envs.length === 0) {
      envs = [...FIXED_ENVIRONMENTS];
    }
    this.saveEnvironments(envs);

    if (this.getActiveEnvId() === envId) {
      this.setActiveEnvId('');
    }
  },

  renameEnvironment(envId: string, newName: string): void {
    const envs = this.getEnvironments();
    const found = envs.find((e) => e.id === envId);
    if (found) {
      found.name = newName.trim() || found.name;
      this.saveEnvironments(envs);
    }
  },

  updateEnvVariables(envId: string, variables: Record<string, string>): void {
    const envs = this.getEnvironments();
    const target = envs.find((e) => e.id === envId);
    if (target) {
      target.variables = variables;
      this.saveEnvironments(envs);
    }
  },

  getActiveEnvId(): string {
    const active = localStorage.getItem(STORAGE_KEYS.ACTIVE_ENV) || '';
    const envs = this.getEnvironments();
    if (envs.some((e) => e.id === active)) return active;
    return '';
  },

  setActiveEnvId(id: string): void {
    if (id) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_ENV, id);
    } else {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_ENV);
    }
  },


  getActiveVariables(): Record<string, string> {
    const activeId = this.getActiveEnvId();
    if (!activeId) return {};
    const envs = this.getEnvironments();
    const found = envs.find((e) => e.id === activeId);
    return found ? found.variables : {};
  },


  // ===================== Domain Cookie Jar =====================
  getDomainCookies(): Record<string, import('../types/http').CookieItem[]> {
    try {
      const data = localStorage.getItem('onetool_http_domain_cookies');
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  },

  saveDomainCookies(domainMap: Record<string, import('../types/http').CookieItem[]>): void {
    localStorage.setItem('onetool_http_domain_cookies', JSON.stringify(domainMap));
  },

  extractDomainFromUrl(rawUrl: string): string {
    try {
      let u = rawUrl.trim();
      if (!u.startsWith('http://') && !u.startsWith('https://')) {
        u = 'http://' + u;
      }
      const parsed = new URL(u);
      return parsed.hostname.toLowerCase();
    } catch {
      return 'localhost';
    }
  },

  getCookiesForUrl(url: string): import('../types/http').CookieItem[] {
    return cookiesForUrl(this.getDomainCookies(), url);
  },

  addOrUpdateCookie(domain: string, cookie: Omit<import('../types/http').CookieItem, 'id' | 'domain'>, editingId?: string): void {
    validateCookie(cookie);
    const map = this.getDomainCookies();
    const dom = normalizeDomain(domain);
    const path = cookie.path || '/';
    const existing = Object.values(map).flat().find(c => c.id === editingId);
    if (editingId && !existing) throw new Error('Cookie 已不存在，请重新打开编辑');
    if (editingId && Object.entries(map).some(([key, items]) => normalizeDomain(key) === dom && items.some(c => c.id !== editingId && c.name === cookie.name && (c.path || '/') === path))) {
      throw new Error('同域名和 Path 下已存在此名称的 Cookie，请修改名称或 Path');
    }
    for (const [key, items] of Object.entries(map)) {
      map[key] = items.filter(c => c.id !== editingId && !(normalizeDomain(key) === dom && c.name === cookie.name && (c.path || '/') === path));
    }
    if (!map[dom]) map[dom] = [];
    if (!cookie.expires || Date.parse(cookie.expires) > Date.now()) {
      map[dom].push({ ...cookie, path, hostOnly: cookie.hostOnly ?? !domain.startsWith('.'), id: existing?.id || 'cookie_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), domain: dom });
    }
    this.saveDomainCookies(map);
  },

  deleteCookie(domain: string, id: string): void {
    const map = this.getDomainCookies();
    if (map[domain]) {
      map[domain] = map[domain].filter(c => c.id !== id);
      this.saveDomainCookies(map);
    }
  },

  deleteDomain(domain: string): void {
    const map = this.getDomainCookies();
    const dom = domain.trim().toLowerCase();
    delete map[dom];
    this.saveDomainCookies(map);
  },

  clearAllCookies(): void {
    localStorage.removeItem('onetool_http_domain_cookies');
  },

  /**
   * 从后端返回的 Set-Cookie 字符串列表中解析并自动保存到对应 domain 中
   */
  saveSetCookies(url: string, setCookies: string[]): void {
    for (const header of setCookies) {
      const cookie = parseSetCookie(url, header);
      if (cookie) this.addOrUpdateCookie(cookie.domain, cookie);
    }
  },
};
