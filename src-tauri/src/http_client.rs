use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpKeyValueItem {
    pub key: String,
    pub value: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpRequestPayload {
    pub method: String,
    pub url: String,
    pub headers: Option<Vec<HttpKeyValueItem>>,
    pub params: Option<Vec<HttpKeyValueItem>>,
    pub cookies: Option<Vec<HttpKeyValueItem>>,
    pub body_type: Option<String>, // "none", "json", "form-data", "x-www-form-urlencoded", "raw"
    pub body_content: Option<String>,
    pub form_data: Option<Vec<HttpKeyValueItem>>,
    pub timeout_seconds: Option<u64>,
    pub ignore_ssl: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpResponsePayload {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub set_cookies: Option<Vec<String>>,
    pub body: String,
    pub elapsed_ms: u128,
    pub size_bytes: usize,
    pub is_json: bool,
    pub final_url: String,
}


/// 执行 HTTP 请求核心方法
pub async fn execute_http_request(req: HttpRequestPayload) -> Result<HttpResponsePayload, String> {
    let mut url_str = req.url.trim().to_string();
    if url_str.is_empty() {
        return Err("请求 URL 不能为空".to_string());
    }

    // 默认补全 http:// 前缀
    if !url_str.starts_with("http://") && !url_str.starts_with("https://") {
        url_str = format!("http://{}", url_str);
    }

    let mut parsed_url = reqwest::Url::parse(&url_str)
        .map_err(|e| format!("无效的 URL: {}", e))?;

    // 拼接 Query Params
    if let Some(params) = req.params {
        let mut pairs_mut = parsed_url.query_pairs_mut();
        for p in params {
            if p.enabled && !p.key.trim().is_empty() {
                pairs_mut.append_pair(p.key.trim(), &p.value);
            }
        }
    }

    let method = reqwest::Method::from_str(&req.method.to_uppercase())
        .map_err(|_| format!("不支持的 HTTP 方法: {}", req.method))?;

    let timeout_secs = req.timeout_seconds.unwrap_or(30);
    let mut client_builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .redirect(reqwest::redirect::Policy::limited(10));

    if req.ignore_ssl.unwrap_or(false) {
        client_builder = client_builder.danger_accept_invalid_certs(true);
    }

    let client = client_builder
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {}", e))?;

    let mut request_builder = client.request(method, parsed_url);

    // 设置请求头
    let mut header_map = HeaderMap::new();
    let mut has_content_type = false;
    let mut manual_cookie_value = String::new();

    if let Some(headers) = req.headers {
        for h in headers {
            if h.enabled && !h.key.trim().is_empty() {
                let k_trimmed = h.key.trim();
                if k_trimmed.eq_ignore_ascii_case("content-type") {
                    has_content_type = true;
                }
                if k_trimmed.eq_ignore_ascii_case("cookie") {
                    manual_cookie_value = h.value.clone();
                    continue; // 稍后与 cookie tab 一起统一合并
                }
                let header_name = HeaderName::from_str(k_trimmed)
                    .map_err(|_| format!("请求头名称不合法: {}", k_trimmed))?;
                let header_val = HeaderValue::from_str(&h.value)
                    .map_err(|_| format!("请求头 {} 的值不合法", k_trimmed))?;
                header_map.insert(header_name, header_val);
            }
        }
    }

    // 合并独立 Cookie 标签项
    let mut cookie_pairs = Vec::new();
    if !manual_cookie_value.trim().is_empty() {
        cookie_pairs.push(manual_cookie_value.trim().to_string());
    }
    if let Some(cookies) = req.cookies {
        for c in cookies {
            if c.enabled && !c.key.trim().is_empty() {
                cookie_pairs.push(format!("{}={}", c.key.trim(), c.value.trim()));
            }
        }
    }
    if !cookie_pairs.is_empty() {
        let full_cookie = cookie_pairs.join("; ");
        let cookie_val = HeaderValue::from_str(&full_cookie)
            .map_err(|_| "Cookie 请求头包含非法字符".to_string())?;
        header_map.insert(reqwest::header::COOKIE, cookie_val);
    }

    let body_type = req.body_type.unwrap_or_else(|| "none".to_string()).to_lowercase();


    // 设置 Body
    match body_type.as_str() {
        "json" => {
            if !has_content_type {
                header_map.insert(
                    reqwest::header::CONTENT_TYPE,
                    HeaderValue::from_static("application/json; charset=utf-8"),
                );
            }
            if let Some(content) = req.body_content {
                request_builder = request_builder.body(content);
            }
        }
        "x-www-form-urlencoded" => {
            if !has_content_type {
                header_map.insert(
                    reqwest::header::CONTENT_TYPE,
                    HeaderValue::from_static("application/x-www-form-urlencoded"),
                );
            }
            if let Some(form_items) = req.form_data {
                let mut pairs = Vec::new();
                for item in form_items {
                    if item.enabled && !item.key.trim().is_empty() {
                        pairs.push((item.key, item.value));
                    }
                }
                request_builder = request_builder.form(&pairs);
            } else if let Some(content) = req.body_content {
                request_builder = request_builder.body(content);
            }
        }
        "form-data" => {
            header_map.remove(reqwest::header::CONTENT_TYPE);
            if let Some(form_items) = req.form_data {
                let mut form = reqwest::multipart::Form::new();
                for item in form_items {
                    if item.enabled && !item.key.trim().is_empty() {
                        form = form.text(item.key, item.value);
                    }
                }
                request_builder = request_builder.multipart(form);
            }
        }
        "raw" => {
            if let Some(content) = req.body_content {
                request_builder = request_builder.body(content);
            }
        }
        _ => {}
    }

    request_builder = request_builder.headers(header_map);

    let start = Instant::now();
    let response = request_builder.send().await.map_err(|e| {
        if e.is_timeout() {
            format!("请求超时（超过 {} 秒）", timeout_secs)
        } else if e.is_connect() {
            format!("网络连接失败: {}", e)
        } else {
            format!("请求失败: {}", e)
        }
    })?;

    let final_url = response.url().to_string();
    let status = response.status().as_u16();
    let status_text = response.status().canonical_reason().unwrap_or("").to_string();

    let mut response_headers = HashMap::new();
    let mut set_cookies = Vec::new();

    for (k, v) in response.headers().iter() {
        if let Ok(val_str) = v.to_str() {
            response_headers.insert(k.as_str().to_string(), val_str.to_string());
        }
    }

    for cookie_header in response.headers().get_all(reqwest::header::SET_COOKIE) {
        if let Ok(val_str) = cookie_header.to_str() {
            set_cookies.push(val_str.to_string());
        }
    }

    let bytes = response.bytes().await.map_err(|e| format!("读取响应体失败: {}", e))?;
    let elapsed_ms = start.elapsed().as_millis();
    let size_bytes = bytes.len();
    let body = String::from_utf8_lossy(&bytes).to_string();

    let is_json = serde_json::from_str::<serde_json::Value>(&body).is_ok();

    Ok(HttpResponsePayload {
        status,
        status_text,
        headers: response_headers,
        set_cookies: if set_cookies.is_empty() { None } else { Some(set_cookies) },
        body,
        elapsed_ms,
        size_bytes,
        is_json,
        final_url,
    })
}
