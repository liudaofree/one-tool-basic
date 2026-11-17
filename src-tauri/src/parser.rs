use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedSqlResult {
    pub raw_sql: String,
    pub formatted_sql: Option<String>,
    pub statement_type: String, // SELECT, INSERT, UPDATE, DELETE, OTHER
    pub param_count: usize,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConvertOptions {
    pub boolean_as_number: bool, // true -> 1/0, false -> true/false
}

impl Default for ConvertOptions {
    fn default() -> Self {
        Self {
            boolean_as_number: false,
        }
    }
}

/// 解析单组或多组 MyBatis 日志文本
pub fn parse_mybatis_logs(log_text: &str, options: &ConvertOptions) -> Vec<ParsedSqlResult> {
    let mut results = Vec::new();
    let lines: Vec<&str> = log_text.lines().collect();

    let mut current_preparing: Option<String> = None;

    for line in lines {
        let trimmed = line.trim();

        // 匹配 ==>  Preparing: ... 或 ==> Preparing: ...
        if let Some(idx) = trimmed.find("Preparing:") {
            let sql_part = trimmed[idx + "Preparing:".len()..].trim();
            // 如果之前有待处理的 preparing 没有 parameters，可能是不带参数的 sql
            if let Some(prev_prep) = current_preparing.take() {
                results.push(generate_sql_result(&prev_prep, "", options));
            }
            current_preparing = Some(sql_part.to_string());
            continue;
        }

        // 匹配 ==> Parameters: ... 或 ==> Parameters:
        if let Some(idx) = trimmed.find("Parameters:") {
            let params_part = trimmed[idx + "Parameters:".len()..].trim();
            if let Some(prep) = current_preparing.take() {
                results.push(generate_sql_result(&prep, params_part, options));
            }
            continue;
        }
    }

    // 处理最后一条没有 Parameters 的 Preparing
    if let Some(prev_prep) = current_preparing.take() {
        results.push(generate_sql_result(&prev_prep, "", options));
    }

    results
}

fn is_parameter_complete(s: &str) -> bool {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed.eq_ignore_ascii_case("null")
        || trimmed.eq_ignore_ascii_case("true")
        || trimmed.eq_ignore_ascii_case("false")
        || trimmed.parse::<f64>().is_ok()
    {
        return true;
    }
    if let (Some(open), Some(close)) = (trimmed.rfind('('), trimmed.rfind(')')) {
        if open < close && close == trimmed.len() - 1 {
            let type_part = &trimmed[open + 1..close];
            if !type_part.is_empty()
                && type_part.starts_with(|c: char| c.is_ascii_alphabetic())
                && type_part.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '[' || c == ']')
            {
                return true;
            }
        }
    }
    false
}

/// 将参数安全解析为 Token 列表，处理带逗号的字符串等边界情况
/// 例: 7(Integer), ORDER123(String), false(Boolean), null, test,world(String)
pub fn parse_parameter_tokens(params_str: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    if params_str.trim().is_empty() {
        return tokens;
    }

    let mut current = String::new();
    let mut in_parentheses = 0;

    for ch in params_str.chars() {
        match ch {
            '(' => {
                in_parentheses += 1;
                current.push(ch);
            }
            ')' => {
                if in_parentheses > 0 {
                    in_parentheses -= 1;
                }
                current.push(ch);
            }
            ',' if in_parentheses == 0 && is_parameter_complete(&current) => {
                let item = current.trim();
                if !item.is_empty() {
                    tokens.push(item.to_string());
                }
                current.clear();
            }
            _ => {
                current.push(ch);
            }
        }
    }

    let last = current.trim();
    if !last.is_empty() {
        tokens.push(last.to_string());
    }

    tokens
}

/// 格式化单个参数值为符合 SQL 规范的字面量
pub fn format_param_value(token: &str, options: &ConvertOptions) -> String {
    let token = token.trim();
    if token.eq_ignore_ascii_case("null") {
        return "NULL".to_string();
    }

    // 检查是否有类型后缀，例如 7(Integer), abc(String), null(String)
    if let (Some(open_idx), Some(close_idx)) = (token.rfind('('), token.rfind(')')) {
        if open_idx < close_idx && close_idx == token.len() - 1 {
            let val = token[..open_idx].trim();
            let type_name = &token[open_idx + 1..close_idx];

            if val.eq_ignore_ascii_case("null") {
                return "NULL".to_string();
            }

            return match type_name.to_ascii_lowercase().as_str() {
                "string" | "date" | "time" | "timestamp" | "localdate" | "localdatetime" => {
                    // 转义单引号
                    let escaped = val.replace('\'', "''");
                    format!("'{}'", escaped)
                }
                "boolean" => {
                    if options.boolean_as_number {
                        if val.eq_ignore_ascii_case("true") { "1".to_string() } else { "0".to_string() }
                    } else {
                        val.to_lowercase()
                    }
                }
                "byte[]" | "blob" => {
                    format!("'{}'", val)
                }
                // 数值类型：Integer, Long, Short, Byte, Float, Double, BigDecimal 等
                _ => val.to_string(),
            };
        }
    }

    // 没有括号类型标注的情况，做智能推断
    if token.eq_ignore_ascii_case("true") || token.eq_ignore_ascii_case("false") {
        if options.boolean_as_number {
            if token.eq_ignore_ascii_case("true") { "1".to_string() } else { "0".to_string() }
        } else {
            token.to_lowercase()
        }
    } else if token.parse::<f64>().is_ok() {
        token.to_string()
    } else {
        format!("'{}'", token.replace('\'', "''"))
    }
}

/// 生成最终还原的 SQL
fn generate_sql_result(preparing: &str, params_str: &str, options: &ConvertOptions) -> ParsedSqlResult {
    let tokens = parse_parameter_tokens(params_str);
    let mut final_sql = String::with_capacity(preparing.len() + tokens.len() * 16);
    let mut token_iter = tokens.iter();
    let mut replaced_count = 0;
    let mut error = None;

    let chars: Vec<char> = preparing.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        if chars[i] == '?' {
            if let Some(param) = token_iter.next() {
                final_sql.push_str(&format_param_value(param, options));
                replaced_count += 1;
            } else {
                final_sql.push('?');
                error = Some("参数数量少于问号占位符(?)数量".to_string());
            }
        } else {
            final_sql.push(chars[i]);
        }
        i += 1;
    }

    if token_iter.next().is_some() {
        error = Some(format!(
            "参数数量({})多于SQL占位符数量({})",
            tokens.len(),
            replaced_count
        ));
    }

    let statement_type = get_statement_type(&final_sql);

    ParsedSqlResult {
        raw_sql: final_sql,
        formatted_sql: None,
        statement_type,
        param_count: replaced_count,
        error,
    }
}

fn get_statement_type(sql: &str) -> String {
    let trimmed = sql.trim_start();
    let first_word = trimmed.split_whitespace().next().unwrap_or("").to_uppercase();
    match first_word.as_str() {
        "SELECT" | "INSERT" | "UPDATE" | "DELETE" => first_word,
        _ => "OTHER".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_sample_log() {
        let log = r#"
 2026-10-14 16:19:16.411 DEBUG 7 --- [  XNIO-1 task-5] demo.OrderMapper.selectOne               : ==>  Preparing: SELECT id,order_no FROM demo_order WHERE (tenant_id = ? AND order_no = ? AND deleted = ?)
 2026-10-14 16:19:16.412 DEBUG 7 --- [  XNIO-1 task-5] demo.OrderMapper.selectOne               : ==> Parameters: 7(Integer), DEMO-001(String), false(Boolean)
        "#;

        let options = ConvertOptions::default();
        let res = parse_mybatis_logs(log, &options);
        assert_eq!(res.len(), 1);
        assert_eq!(res[0].param_count, 3);
        assert!(res[0].error.is_none());
        assert_eq!(
            res[0].raw_sql,
            "SELECT id,order_no FROM demo_order WHERE (tenant_id = 7 AND order_no = 'DEMO-001' AND deleted = false)"
        );
    }

    #[test]
    fn test_comma_in_string_param() {
        let prep = "SELECT * FROM t WHERE name = ? AND id = ?";
        let params = "hello, world(String), 123(Long)";
        let options = ConvertOptions::default();
        let res = generate_sql_result(prep, params, &options);
        assert_eq!(res.raw_sql, "SELECT * FROM t WHERE name = 'hello, world' AND id = 123");
    }

    #[test]
    fn test_null_param() {
        let prep = "UPDATE t SET remark = ? WHERE id = ?";
        let params = "null, 1(Integer)";
        let options = ConvertOptions::default();
        let res = generate_sql_result(prep, params, &options);
        assert_eq!(res.raw_sql, "UPDATE t SET remark = NULL WHERE id = 1");
    }
}
