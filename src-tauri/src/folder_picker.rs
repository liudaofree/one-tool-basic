#[cfg(windows)]
#[tauri::command]
pub async fn pick_download_folder() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
        use windows::Win32::UI::Shell::{FileOpenDialog, IFileOpenDialog, FOS_PICKFOLDERS, SIGDN_FILESYSPATH};
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().map_err(|e| e.to_string())?;
            let result = (|| -> Result<Option<String>, String> {
                let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER).map_err(|e| e.to_string())?;
                let options = dialog.GetOptions().map_err(|e| e.to_string())?;
                dialog.SetOptions(options | FOS_PICKFOLDERS).map_err(|e| e.to_string())?;
                if dialog.Show(None).is_err() { return Ok(None); }
                let item = dialog.GetResult().map_err(|e| e.to_string())?;
                let path = item.GetDisplayName(SIGDN_FILESYSPATH).map_err(|e| e.to_string())?;
                let value = path.to_string().map_err(|e| e.to_string())?;
                CoTaskMemFree(Some(path.0.cast()));
                Ok(Some(value))
            })();
            CoUninitialize();
            result
        }
    }).await.map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn pick_download_folder() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let output = std::process::Command::new("osascript")
            .args(["-e", "POSIX path of (choose folder with prompt \"选择下载保存目录\")"])
            .output()
            .map_err(|error| error.to_string())?;
        if output.status.success() {
            return Ok(Some(String::from_utf8(output.stdout).map_err(|error| error.to_string())?.trim_end().to_owned()));
        }
        let error = String::from_utf8_lossy(&output.stderr);
        if error.contains("-128") { Ok(None) } else { Err(error.trim().to_owned()) }
    }).await.map_err(|error| error.to_string())?
}

#[cfg(not(any(windows, target_os = "macos")))]
#[tauri::command]
pub async fn pick_download_folder() -> Result<Option<String>, String> {
    Err("文件夹选择目前仅支持 Windows 和 macOS".into())
}
