use std::{collections::HashMap, fs, time::Duration};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::Manager;

fn key_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("ai-keys.dat"))
}

#[cfg(target_os = "macos")]
fn read_keys(_app: &tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    match crate::mac_keychain::read("com.onetool.app.ai-keys")? {
        Some(bytes) => serde_json::from_slice(&bytes).map_err(|error| error.to_string()),
        None => Ok(HashMap::new()),
    }
}

#[cfg(target_os = "macos")]
fn write_keys(_app: &tauri::AppHandle, keys: &HashMap<String, String>) -> Result<(), String> {
    let bytes = serde_json::to_vec(keys).map_err(|error| error.to_string())?;
    crate::mac_keychain::write("com.onetool.app.ai-keys", &bytes)
}

#[cfg(not(target_os = "macos"))]
fn read_keys(app: &tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    let path = key_path(app)?;
    let readable = if path.exists() { path.clone() } else { path.with_extension("dat.bak") };
    if !readable.exists() { return Ok(HashMap::new()); }
    let encrypted = fs::read(readable).map_err(|e| e.to_string())?;
    let plain = crate::credentials::unprotect(&encrypted)?;
    serde_json::from_slice(&plain).map_err(|e| e.to_string())
}

#[cfg(not(target_os = "macos"))]
fn write_keys(app: &tauri::AppHandle, keys: &HashMap<String, String>) -> Result<(), String> {
    let path = key_path(app)?;
    let plain = serde_json::to_vec(keys).map_err(|e| e.to_string())?;
    let encrypted = crate::credentials::protect(&plain)?;
    let temporary = path.with_extension("dat.tmp");
    let backup = path.with_extension("dat.bak");
    fs::write(&temporary, encrypted).map_err(|e| e.to_string())?;
    if path.exists() {
        if backup.exists() { fs::remove_file(&backup).map_err(|e| e.to_string())?; }
        fs::rename(&path, &backup).map_err(|e| e.to_string())?;
    }
    if let Err(error) = fs::rename(&temporary, &path) {
        if backup.exists() { let _ = fs::rename(&backup, &path); }
        return Err(error.to_string());
    }
    if backup.exists() { let _ = fs::remove_file(backup); }
    Ok(())
}

#[tauri::command]
pub fn save_ai_api_key(app: tauri::AppHandle, profile_id: String, api_key: String) -> Result<(), String> {
    if profile_id.trim().is_empty() || api_key.trim().is_empty() { return Err("配置 ID 和 API Key 不能为空".into()); }
    let mut keys = read_keys(&app)?;
    keys.insert(profile_id, api_key.trim().to_string());
    write_keys(&app, &keys)
}

#[tauri::command]
pub fn delete_ai_api_key(app: tauri::AppHandle, profile_id: String) -> Result<(), String> {
    let mut keys = read_keys(&app)?;
    keys.remove(&profile_id);
    write_keys(&app, &keys)
}

#[tauri::command]
pub fn has_ai_api_key(app: tauri::AppHandle, profile_id: String) -> Result<bool, String> {
    Ok(read_keys(&app)?.contains_key(&profile_id))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    profile_id: String,
    provider: String,
    model: String,
    messages: Vec<Value>,
    tools: Vec<Value>,
}

#[derive(Serialize)]
pub struct AiChatResponse {
    message: Value,
    usage: Option<Value>,
}

fn endpoint(provider: &str) -> Result<&'static str, String> {
    match provider {
        "deepseek" => Ok("https://api.deepseek.com/chat/completions"),
        "minimax-cn" => Ok("https://api.minimax.cn/v1/chat/completions"),
        "minimax-intl" => Ok("https://api.minimax.io/v1/chat/completions"),
        _ => Err("不支持的 AI 服务商".into()),
    }
}

fn parse_chat_response(value: Value) -> Result<AiChatResponse, String> {
    if value.pointer("/base_resp/status_code").and_then(Value::as_i64).is_some_and(|code| code != 0) {
        return Err("MiniMax 返回业务错误，请检查模型和账户状态".into());
    }
    let message = value.pointer("/choices/0/message").cloned().ok_or("AI 服务没有返回消息")?;
    Ok(AiChatResponse { message, usage: value.get("usage").cloned() })
}

fn http_error(provider: &str, status: reqwest::StatusCode) -> String {
    match status.as_u16() {
        401 => "认证失败（HTTP 401）：请检查 API Key 是否属于所选服务商".into(),
        402 if provider == "deepseek" => "DeepSeek 账户余额不足（HTTP 402）：请到 DeepSeek 开放平台检查 API 账户余额".into(),
        402 => "服务商拒绝计费请求（HTTP 402）：请检查 API 账户余额和计费状态".into(),
        429 => "请求过于频繁（HTTP 429）：请稍后重试".into(),
        _ => format!("AI 服务返回 HTTP {}，请检查模型、账户状态和服务商", status.as_u16()),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConnectionTestRequest {
    profile_id: String,
    provider: String,
    model: String,
    api_key: Option<String>,
}

#[tauri::command]
pub async fn test_ai_connection(app: tauri::AppHandle, request: AiConnectionTestRequest) -> Result<String, String> {
    let url = endpoint(&request.provider)?;
    if request.model.trim().is_empty() { return Err("请填写模型名称".into()); }
    let key = match request.api_key.filter(|value| !value.trim().is_empty()) {
        Some(value) => value.trim().to_string(),
        None => read_keys(&app)?.remove(&request.profile_id).ok_or("请填写 API Key 或先保存配置")?,
    };
    let mut body = json!({
        "model": request.model,
        "messages": [{ "role": "user", "content": "请回复 OK" }],
        "stream": false,
    });
    if request.provider == "deepseek" { body["max_tokens"] = json!(16); }
    else { body["max_completion_tokens"] = json!(64); }
    let client = reqwest::Client::builder().timeout(Duration::from_secs(30)).build().map_err(|_| "无法创建 AI 请求客户端")?;
    let response = client.post(url).bearer_auth(key).json(&body).send().await.map_err(|_| "无法连接 AI 服务，请检查网络")?;
    let status = response.status();
    if !status.is_success() { return Err(http_error(&request.provider, status)); }
    let value: Value = response.json().await.map_err(|_| "AI 服务返回的数据格式无效")?;
    parse_chat_response(value)?;
    Ok("连接成功，模型已返回响应".into())
}

#[tauri::command]
pub async fn ai_chat_completion(app: tauri::AppHandle, request: AiChatRequest) -> Result<AiChatResponse, String> {
    let url = endpoint(&request.provider)?;
    if request.model.trim().is_empty() || request.messages.is_empty() || request.messages.len() > 60 {
        return Err("模型或对话内容无效".into());
    }
    let key = read_keys(&app)?.remove(&request.profile_id).ok_or("此配置尚未保存 API Key")?;
    let mut body = json!({ "model": request.model, "messages": request.messages, "tools": request.tools, "tool_choice": "auto", "stream": false });
    if request.provider == "deepseek" { body["max_tokens"] = json!(4096); }
    else { body["max_completion_tokens"] = json!(8192); }
    if body.to_string().len() > 1_000_000 { return Err("本次对话内容过大，请缩短输入".into()); }
    let client = reqwest::Client::builder().timeout(Duration::from_secs(120)).build().map_err(|_| "无法创建 AI 请求客户端")?;
    let response = client.post(url).bearer_auth(key).json(&body).send().await.map_err(|_| "无法连接 AI 服务，请检查网络")?;
    let status = response.status();
    if !status.is_success() { return Err(http_error(&request.provider, status)); }
    let value: Value = response.json().await.map_err(|_| "AI 服务返回的数据格式无效")?;
    parse_chat_response(value)
}

#[cfg(test)]
mod tests {
    use super::{endpoint, http_error, parse_chat_response};
    use serde_json::json;

    #[test]
    fn only_known_ai_hosts_are_used() {
        assert_eq!(endpoint("deepseek").unwrap(), "https://api.deepseek.com/chat/completions");
        assert_eq!(endpoint("minimax-cn").unwrap(), "https://api.minimax.cn/v1/chat/completions");
        assert_eq!(endpoint("minimax-intl").unwrap(), "https://api.minimax.io/v1/chat/completions");
        assert!(endpoint("https://example.com").is_err());
    }

    #[test]
    fn tool_call_response_is_preserved_for_local_execution() {
        let response = parse_chat_response(json!({ "choices": [{ "message": { "role": "assistant", "content": null, "tool_calls": [{ "id": "call_1", "type": "function", "function": { "name": "plugin_analysis", "arguments": "{\"json\":\"{}\"}" } }] } }] })).unwrap();
        assert_eq!(response.message.pointer("/tool_calls/0/function/name").and_then(|v| v.as_str()), Some("plugin_analysis"));
    }

    #[test]
    fn payment_error_is_not_reported_as_invalid_key() {
        let message = http_error("deepseek", reqwest::StatusCode::PAYMENT_REQUIRED);
        assert!(message.contains("余额不足"));
        assert!(!message.contains("API Key"));
    }
}
