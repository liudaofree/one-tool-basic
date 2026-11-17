export interface HttpKeyValueItem {
  key: string;
  value: string;
  enabled: boolean;
}

export interface HttpRequestPayload {
  method: string;
  url: string;
  headers?: HttpKeyValueItem[];
  params?: HttpKeyValueItem[];
  cookies?: HttpKeyValueItem[];
  body_type?: string; // "none" | "json" | "form-data" | "x-www-form-urlencoded" | "raw"
  body_content?: string;
  form_data?: HttpKeyValueItem[];
  timeout_seconds?: number;
  ignore_ssl?: boolean;
}

export interface CookieItem {
  id: string;
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: string;
  httpOnly?: boolean;
  secure?: boolean;
  hostOnly?: boolean;
}

export interface DomainCookies {
  domain: string;
  cookies: CookieItem[];
}

export interface HttpResponsePayload {
  status: number;
  status_text: string;
  headers: Record<string, string>;
  set_cookies?: string[]; // 捕获响应头中 Set-Cookie 列表
  body: string;
  elapsed_ms: number;
  size_bytes: number;
  is_json: boolean;
  final_url?: string;
}


export interface HistoryItem {
  id: string;
  name?: string;
  group?: string;
  timestamp: number;
  method: string;
  url: string;
  status: number;
  elapsed_ms: number;
  payload: HttpRequestPayload;
}

export interface SavedRequest {
  id: string;
  name: string;
  group?: string;
  folder?: string;
  createdAt: number;
  payload: HttpRequestPayload;
}

export interface Environment {
  id: string;
  name: string;
  variables: Record<string, string>;
}
