use reqwest::header::{CONTENT_RANGE, ETAG, IF_RANGE, LAST_MODIFIED, RANGE};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs::{self, OpenOptions}, io::{Read, Seek, SeekFrom, Write}, path::{Path, PathBuf}, sync::{Arc, Mutex, atomic::{AtomicU64, Ordering}}, time::{Duration, Instant}};
use tauri::State;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTask {
    id: u64, url: String, path: String, status: String,
    completed: u64, total: Option<u64>, speed: u64, connections: usize,
    error: Option<String>, validator: Option<String>,
    #[serde(default)]
    segments: Vec<Segment>,
    #[serde(skip)]
    segment_speeds: Vec<u64>,
}

#[derive(Clone, Serialize, Deserialize)]
struct Segment { start: u64, end: u64, done: u64 }

#[derive(Default)]
pub struct DownloadState {
    next_id: AtomicU64,
    tasks: Mutex<HashMap<u64, DownloadTask>>,
    store: Option<PathBuf>,
    save_lock: Mutex<()>,
}

impl DownloadState {
    pub fn load(store: PathBuf) -> Self {
        let readable = if store.exists() { store.clone() } else { store.with_extension("json.bak") };
        let saved: Vec<DownloadTask> = fs::read(readable).ok()
            .and_then(|data| serde_json::from_slice(&data).ok()).unwrap_or_default();
        let mut tasks = HashMap::new();
        let mut next_id = 0;
        for mut task in saved {
            next_id = next_id.max(task.id);
            task.speed = 0;
            task.segment_speeds = vec![0; task.segments.len()];
            let path = Path::new(&task.path);
            if task.status != "completed" {
                task.status = "paused".into();
                if !part_path(path).is_file() {
                    task.status = "error".into();
                    task.error = Some("未找到未完成文件，请检查保存目录".into());
                } else if task.segments.is_empty() {
                    task.completed = fs::metadata(part_path(path)).map(|m| m.len()).unwrap_or(0);
                }
            }
            tasks.insert(task.id, task);
        }
        Self { next_id: AtomicU64::new(next_id), tasks: Mutex::new(tasks), store: Some(store), save_lock: Mutex::new(()) }
    }

    fn save(&self) -> Result<(), String> {
        let Some(path) = &self.store else { return Ok(()); };
        let _guard = self.save_lock.lock().map_err(|_| "任务存储不可用")?;
        let tasks: Vec<_> = self.tasks.lock().map_err(|_| "任务状态不可用")?.values().cloned().collect();
        let data = serde_json::to_vec(&tasks).map_err(|e| e.to_string())?;
        if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        let temporary = path.with_extension("json.tmp");
        fs::write(&temporary, data).map_err(|e| e.to_string())?;
        let backup = path.with_extension("json.bak");
        if path.exists() {
            if backup.exists() { fs::remove_file(&backup).map_err(|e| e.to_string())?; }
            fs::rename(path, &backup).map_err(|e| e.to_string())?;
        }
        fs::rename(&temporary, path).map_err(|e| e.to_string())
    }
}

fn part_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(".part");
    PathBuf::from(name)
}

fn update(state: &DownloadState, id: u64, change: impl FnOnce(&mut DownloadTask)) {
    if let Ok(mut tasks) = state.tasks.lock() {
        if let Some(task) = tasks.get_mut(&id) { change(task); }
    }
}

fn snapshot(state: &DownloadState, id: u64) -> Option<DownloadTask> {
    state.tasks.lock().ok()?.get(&id).cloned()
}

fn content_range_total(value: &str) -> Option<u64> {
    let (_, total) = value.split_once('/')?;
    total.parse().ok()
}

fn run_segment(state: Arc<DownloadState>, id: u64, index: usize, validator: String) -> Result<(), String> {
    let task = snapshot(&state, id).ok_or("任务不存在")?;
    let segment = task.segments.get(index).ok_or("分段不存在")?;
    if segment.start + segment.done > segment.end { return Ok(()); }
    let client = reqwest::blocking::Client::builder().connect_timeout(Duration::from_secs(15))
        .build().map_err(|e| e.to_string())?;
    let mut file = OpenOptions::new().write(true).open(part_path(Path::new(&task.path)))
        .map_err(|e| format!("无法打开下载文件：{e}"))?;
    let mut buffer = [0u8; 128 * 1024];
    let mut last_tick = Instant::now();
    let mut tick_bytes = 0u64;
    let mut retries = 0u64;
    loop {
        if snapshot(&state, id).is_some_and(|t| t.status == "pausing") { return Ok(()); }
        let current = snapshot(&state, id).ok_or("任务不存在")?;
        let start = current.segments[index].start + current.segments[index].done;
        if start > segment.end { break; }
        let mut response = client.get(&task.url)
            .header(RANGE, format!("bytes={start}-{}", segment.end))
            .header(IF_RANGE, &validator)
            .send().map_err(|e| e.to_string())?;
        let code = response.status();
        if matches!(code.as_u16(), 428 | 429 | 503) && retries < 4 {
            retries += 1;
            std::thread::sleep(Duration::from_millis(retries * 1000 + index as u64 * 150));
            continue;
        }
        let expected_range = format!("bytes {start}-{}/{}", segment.end, task.total.unwrap_or(0));
        let actual_range = response.headers().get(CONTENT_RANGE).and_then(|v| v.to_str().ok()).unwrap_or("");
        if matches!(code.as_u16(), 428 | 429 | 503) {
            return Err(format!("服务器临时拒绝分段请求（HTTP {code}），自动重试 4 次后仍失败；可稍后点击继续"));
        }
        if code != reqwest::StatusCode::PARTIAL_CONTENT || actual_range != expected_range {
            return Err(format!("服务器不支持稳定的分段下载：HTTP {code}"));
        }
        file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
        let mut remaining = segment.end - start + 1;
        while remaining > 0 {
            if snapshot(&state, id).is_some_and(|t| t.status == "pausing") { return Ok(()); }
            let limit = buffer.len().min(remaining as usize);
            let count = response.read(&mut buffer[..limit]).map_err(|e| e.to_string())?;
            if count == 0 { return Err("分段提前结束".into()); }
            file.write_all(&buffer[..count]).map_err(|e| format!("写入失败：{e}"))?;
            remaining -= count as u64;
            tick_bytes += count as u64;
            let elapsed = last_tick.elapsed();
            let sample_speed = (elapsed >= Duration::from_millis(500))
                .then(|| (tick_bytes as f64 / elapsed.as_secs_f64()) as u64);
            update(&state, id, |t| {
                t.segments[index].done += count as u64;
                t.completed += count as u64;
                if let Some(speed) = sample_speed {
                    t.segment_speeds[index] = speed;
                    t.speed = t.segment_speeds.iter().sum();
                }
            });
            if sample_speed.is_some() { tick_bytes = 0; last_tick = Instant::now(); }
            }
        break;
    }
    file.flush().map_err(|e| e.to_string())?;
    update(&state, id, |t| {
        t.segment_speeds[index] = 0;
        t.speed = t.segment_speeds.iter().sum();
    });
    Ok(())
}

fn run_segmented(state: Arc<DownloadState>, id: u64) -> Result<bool, String> {
    let task = snapshot(&state, id).ok_or("任务不存在")?;
    if task.segments.is_empty() {
        if fs::metadata(part_path(Path::new(&task.path))).map(|m| m.len()).unwrap_or(0) > 0 {
            return Ok(false);
        }
        let response = reqwest::blocking::Client::builder().connect_timeout(Duration::from_secs(15))
            .build().map_err(|e| e.to_string())?
            .get(&task.url).header(RANGE, "bytes=0-0")
            .send().map_err(|e| e.to_string())?;
        let total = response.headers().get(CONTENT_RANGE).and_then(|v| v.to_str().ok())
            .and_then(content_range_total);
        let validator = response.headers().get(ETAG).or_else(|| response.headers().get(LAST_MODIFIED))
            .and_then(|v| v.to_str().ok()).map(str::to_owned);
        if response.status() != reqwest::StatusCode::PARTIAL_CONTENT || !total.is_some_and(|n| n >= 1024 * 1024) || validator.is_none() {
            return Ok(false);
        }
        let total = total.unwrap();
        let connections = if total >= 16 * 1024 * 1024 { 8 } else { 4 };
        let chunk = total.div_ceil(connections);
        let segments = (0..connections).filter_map(|i| {
            let start = i * chunk;
            (start < total).then_some(Segment { start, end: (start + chunk - 1).min(total - 1), done: 0 })
        }).collect();
        OpenOptions::new().write(true).open(part_path(Path::new(&task.path)))
            .map_err(|e| e.to_string())?.set_len(total).map_err(|e| e.to_string())?;
        update(&state, id, |t| { t.total = Some(total); t.validator = validator; t.segments = segments; t.connections = t.segments.len(); t.segment_speeds = vec![0; t.segments.len()]; });
    }
    let current = snapshot(&state, id).ok_or("任务不存在")?;
    let validator = current.validator.ok_or("缺少文件版本信息")?;
    update(&state, id, |t| { t.segment_speeds.fill(0); t.speed = 0; });
    let handles: Vec<_> = (0..current.segments.len()).map(|index| {
        let state = state.clone();
        let validator = validator.clone();
        std::thread::spawn(move || run_segment(state, id, index, validator))
    }).collect();
    let mut first_error = None;
    for handle in handles {
        let result = handle.join().map_err(|_| "分段线程失败".to_string())?;
        if let Err(error) = result { first_error.get_or_insert(error); }
    }
    if snapshot(&state, id).is_some_and(|t| t.status == "pausing") {
        update(&state, id, |t| { t.status = "paused".into(); t.speed = 0; });
        return Ok(true);
    }
    if let Some(error) = first_error { return Err(error); }
    let current = snapshot(&state, id).ok_or("任务不存在")?;
    if current.segments.iter().any(|s| s.start + s.done != s.end + 1) {
        return Err("分段下载未完成".into());
    }
    let path = Path::new(&current.path);
    fs::rename(part_path(path), path).map_err(|e| format!("保存完成文件失败：{e}"))?;
    update(&state, id, |t| { t.status = "completed".into(); t.speed = 0; });
    Ok(true)
}

fn run_download(state: Arc<DownloadState>, id: u64) -> Result<(), String> {
    if run_segmented(state.clone(), id)? { return Ok(()); }
    let task = snapshot(&state, id).ok_or("任务不存在")?;
    let path = PathBuf::from(&task.path);
    let part = part_path(&path);
    let mut offset = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    let client = reqwest::blocking::Client::builder().connect_timeout(Duration::from_secs(15))
        .build().map_err(|e| e.to_string())?;
    let mut request = client.get(&task.url);
    if offset > 0 {
        if let Some(validator) = &task.validator {
            request = request.header(RANGE, format!("bytes={offset}-")).header(IF_RANGE, validator);
        } else { offset = 0; }
    }
    let mut response = request.send().map_err(|e| e.to_string())?;
    let resumed = offset > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    if resumed {
        let expected = format!("bytes {offset}-");
        let range = response.headers().get(CONTENT_RANGE).and_then(|v| v.to_str().ok()).unwrap_or("");
        if !range.starts_with(&expected) { return Err("服务器返回的续传范围不匹配".into()); }
    } else if !response.status().is_success() || response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!("下载请求失败：HTTP {}", response.status()));
    } else { offset = 0; }
    let validator = response.headers().get(ETAG).or_else(|| response.headers().get(LAST_MODIFIED))
        .and_then(|v| v.to_str().ok()).map(str::to_owned);
    let total = response.content_length().map(|n| n + offset);
    update(&state, id, |t| { t.completed = offset; t.total = total; t.validator = validator; t.error = None; });
    let mut file = OpenOptions::new().create(true).write(true).append(resumed).truncate(!resumed)
        .open(&part).map_err(|e| format!("无法写入文件：{e}"))?;
    let mut buffer = [0u8; 64 * 1024];
    let mut completed = offset;
    let mut last_tick = Instant::now();
    let mut tick_bytes = 0u64;
    loop {
        if snapshot(&state, id).is_some_and(|t| t.status == "pausing") {
            update(&state, id, |t| t.status = "paused".into());
            return Ok(());
        }
        let count = response.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 { break; }
        file.write_all(&buffer[..count]).map_err(|e| format!("写入失败：{e}"))?;
        completed += count as u64;
        tick_bytes += count as u64;
        let elapsed = last_tick.elapsed();
        if elapsed >= Duration::from_millis(500) {
            let speed = (tick_bytes as f64 / elapsed.as_secs_f64()) as u64;
            update(&state, id, |t| { t.completed = completed; t.speed = speed; });
            tick_bytes = 0;
            last_tick = Instant::now();
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);
    if snapshot(&state, id).is_some_and(|t| t.status == "pausing") {
        update(&state, id, |t| t.status = "paused".into());
        return Ok(());
    }
    if total.is_some_and(|n| completed != n) { return Err("下载长度与服务器声明不一致".into()); }
    fs::rename(&part, &path).map_err(|e| format!("保存完成文件失败：{e}"))?;
    update(&state, id, |t| { t.completed = completed; t.speed = 0; t.status = "completed".into(); });
    Ok(())
}

fn launch(state: Arc<DownloadState>, id: u64) {
    std::thread::spawn(move || {
        if let Err(error) = run_download(state.clone(), id) {
            update(&state, id, |t| { if t.status == "pausing" {
                t.status = "paused".into(); t.speed = 0;
            } else if t.status != "paused" {
                t.status = "error".into(); t.error = Some(error); t.speed = 0;
            } });
        }
        let _ = state.save();
    });
}

#[tauri::command]
pub fn download_list(state: State<'_, Arc<DownloadState>>) -> Vec<DownloadTask> {
    let _ = state.save();
    let mut tasks: Vec<_> = state.tasks.lock().map(|t| t.values().cloned().collect()).unwrap_or_default();
    tasks.sort_by_key(|t: &DownloadTask| std::cmp::Reverse(t.id));
    tasks
}

#[tauri::command]
pub fn download_add(state: State<'_, Arc<DownloadState>>, url: String, directory: String) -> Result<u64, String> {
    let parsed = reqwest::Url::parse(url.trim()).map_err(|_| "下载链接无效".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") { return Err("目前仅支持 HTTP/HTTPS 直链".into()); }
    let name = parsed.path_segments().and_then(|mut p| p.next_back()).filter(|n| !n.is_empty()).unwrap_or("download");
    let name = name.chars().map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' }).collect::<String>();
    let name = if name == "." || name == ".." { "download" } else { &name };
    let dir = Path::new(directory.trim());
    if !dir.is_dir() { return Err("保存目录不存在".into()); }
    let path = (0..1000).map(|n| {
        if n == 0 { return dir.join(name); }
        let stem = Path::new(name).file_stem().and_then(|s| s.to_str()).unwrap_or(name);
        let extension = Path::new(name).extension().and_then(|s| s.to_str());
        dir.join(match extension {
            Some(ext) => format!("{stem} ({n}).{ext}"),
            None => format!("{name} ({n})"),
        })
    })
        .find(|p| !p.exists() && !part_path(p).exists()).ok_or("可用文件名不足")?;
    let part = part_path(&path);
    OpenOptions::new().write(true).create_new(true).open(&part)
        .map_err(|e| format!("无法在 {} 创建下载文件：{e}。请检查目录写入权限或选择其他保存目录", part.display()))?;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    state.tasks.lock().map_err(|_| "任务状态不可用".to_string())?.insert(id, DownloadTask {
        id, url: parsed.to_string(), path: path.to_string_lossy().into_owned(), status: "active".into(),
        completed: 0, total: None, speed: 0, connections: 1, error: None, validator: None, segments: Vec::new(), segment_speeds: Vec::new(),
    });
    state.save()?;
    launch(state.inner().clone(), id);
    Ok(id)
}

#[tauri::command]
pub fn download_control(state: State<'_, Arc<DownloadState>>, id: u64, action: String) -> Result<(), String> {
    let mut tasks = state.tasks.lock().map_err(|_| "任务状态不可用".to_string())?;
    let task = tasks.get_mut(&id).ok_or("任务不存在")?;
    match (action.as_str(), task.status.as_str()) {
        ("pause", "active") => { task.status = "pausing".into(); task.speed = 0; }
        ("resume", "paused" | "error") => { task.status = "active".into(); task.error = None; launch(state.inner().clone(), id); }
        _ => return Err("当前状态不能执行此操作".into()),
    }
    drop(tasks);
    state.save()?;
    Ok(())
}

#[tauri::command]
pub fn download_open_folder(state: State<'_, Arc<DownloadState>>, id: u64) -> Result<(), String> {
    let task = snapshot(&state, id).ok_or("任务不存在")?;
    if task.status != "completed" { return Err("任务尚未完成".into()); }
    let file = Path::new(&task.path);
    if !file.is_file() { return Err("文件不存在，可能已被移动或删除".into()); }
    let folder = file.parent().ok_or("无法确定保存目录")?;
    #[cfg(windows)]
    {
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let folder = folder.to_string_lossy().into_owned();
        let path = windows::core::HSTRING::from(folder.as_str());
        let result = unsafe {
            ShellExecuteW(None, windows::core::w!("open"), &path, None, None, SW_SHOWNORMAL)
        };
        if result.0 as isize <= 32 {
            if result.0 as isize == 5 {
                return Err(format!("当前进程无权限启动资源管理器。请从普通 Windows 终端启动 One Tool，或复制目录后手动打开：{folder}"));
            }
            return Err(format!("Windows 无法打开文件夹 {folder}（ShellExecute 错误码 {}）", result.0 as isize));
        }
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(folder).spawn()
            .map_err(|error| format!("无法打开保存目录：{error}"))?;
        Ok(())
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = folder;
        Err("打开文件夹目前仅支持 Windows 和 macOS".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn downloads_file_to_final_path() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            for _ in 0..2 {
                let (mut socket, _) = listener.accept().unwrap();
                let mut request = [0u8; 1024];
                socket.read(&mut request).unwrap();
                socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello").unwrap();
            }
        });
        let dir = std::env::current_dir().unwrap().join("target").join(format!("one-tool-download-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sample.txt");
        let state = Arc::new(DownloadState::default());
        state.tasks.lock().unwrap().insert(1, DownloadTask {
            id: 1, url: format!("http://{address}/sample.txt"), path: path.to_string_lossy().into_owned(),
            status: "active".into(), completed: 0, total: None, speed: 0, connections: 1, error: None, validator: None, segments: Vec::new(), segment_speeds: Vec::new(),
        });
        run_download(state.clone(), 1).unwrap();
        server.join().unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"hello");
        assert_eq!(snapshot(&state, 1).unwrap().status, "completed");
        assert!(!part_path(&path).exists());
        fs::remove_dir_all(dir).unwrap();
    }

    fn downloads_ranges_to_one_file(size: usize) {
        let bytes: Vec<u8> = (0..size).map(|n| (n % 251) as u8).collect();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let source = Arc::new(bytes.clone());
        let server = std::thread::spawn(move || {
            let mut workers = Vec::new();
            for _ in 0..if size >= 16 * 1024 * 1024 { 9 } else { 5 } {
                let (mut socket, _) = listener.accept().unwrap();
                let source = source.clone();
                workers.push(std::thread::spawn(move || {
                    let mut request = Vec::new();
                    let mut buffer = [0u8; 2048];
                    while !request.windows(4).any(|v| v == b"\r\n\r\n") {
                        let count = socket.read(&mut buffer).unwrap();
                        assert!(count > 0);
                        request.extend_from_slice(&buffer[..count]);
                    }
                    let request = String::from_utf8(request).unwrap();
                    let range = request.lines().find(|line| line.to_ascii_lowercase().starts_with("range:")).unwrap();
                    let values = range.split('=').nth(1).unwrap();
                    let (start, end) = values.split_once('-').unwrap();
                    let start: usize = start.parse().unwrap();
                    let end: usize = if end.is_empty() { source.len() - 1 } else { end.parse().unwrap() };
                    let body = &source[start..=end];
                    let header = format!("HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {start}-{end}/{}\r\nContent-Length: {}\r\nETag: \"v1\"\r\nConnection: close\r\n\r\n", source.len(), body.len());
                    socket.write_all(header.as_bytes()).unwrap();
                    socket.write_all(body).unwrap();
                }));
            }
            for worker in workers { worker.join().unwrap(); }
        });
        let dir = std::env::current_dir().unwrap().join("target").join(format!("one-tool-range-test-{}-{size}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sample.bin");
        fs::write(part_path(&path), []).unwrap();
        let state = Arc::new(DownloadState::default());
        state.tasks.lock().unwrap().insert(1, DownloadTask {
            id: 1, url: format!("http://{address}/sample.bin"), path: path.to_string_lossy().into_owned(),
            status: "active".into(), completed: 0, total: None, speed: 0, connections: 1, error: None,
            validator: None, segments: Vec::new(), segment_speeds: Vec::new(),
        });
        run_download(state.clone(), 1).unwrap();
        server.join().unwrap();
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(snapshot(&state, 1).unwrap().status, "completed");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn downloads_four_ranges_to_one_file() {
        downloads_ranges_to_one_file(1024 * 1024 + 17);
    }

    #[test]
    fn downloads_eight_ranges_to_one_file() {
        downloads_ranges_to_one_file(16 * 1024 * 1024 + 17);
    }

    #[test]
    fn retries_transient_428_without_losing_segment() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            for attempt in 0..2 {
                let (mut socket, _) = listener.accept().unwrap();
                let mut request = [0u8; 1024];
                socket.read(&mut request).unwrap();
                if attempt == 0 {
                    socket.write_all(b"HTTP/1.1 428 Precondition Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
                } else {
                    socket.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 0-4/5\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello").unwrap();
                }
            }
        });
        let dir = std::env::current_dir().unwrap().join("target").join(format!("one-tool-retry-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sample.bin");
        fs::write(part_path(&path), [0u8; 5]).unwrap();
        let state = Arc::new(DownloadState::default());
        state.tasks.lock().unwrap().insert(1, DownloadTask {
            id: 1, url: format!("http://{address}/sample.bin"), path: path.to_string_lossy().into_owned(),
            status: "active".into(), completed: 0, total: Some(5), speed: 0, connections: 1,
            error: None, validator: Some("\"v1\"".into()),
            segments: vec![Segment { start: 0, end: 4, done: 0 }], segment_speeds: vec![0],
        });
        run_segment(state.clone(), 1, 0, "\"v1\"".into()).unwrap();
        server.join().unwrap();
        assert_eq!(fs::read(part_path(&path)).unwrap(), b"hello");
        assert_eq!(snapshot(&state, 1).unwrap().completed, 5);
        fs::remove_dir_all(dir).unwrap();
    }
}
