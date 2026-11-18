pub mod http_client;
pub mod parser;
pub mod download;
pub mod folder_picker;
pub mod credentials;
pub mod ai;
#[cfg(target_os = "macos")]
mod mac_keychain;

#[tauri::command]
fn parse_mybatis_logs(log_text: String, options: Option<parser::ConvertOptions>) -> Vec<parser::ParsedSqlResult> {
    parser::parse_mybatis_logs(&log_text, &options.unwrap_or_default())
}

#[tauri::command]
async fn send_http_request(req: http_client::HttpRequestPayload) -> Result<http_client::HttpResponsePayload, String> {
    http_client::execute_http_request(req).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default();
  #[cfg(desktop)]
  {
    use tauri::Manager;
    // Register first so a second launch exits before other plugins initialize.
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
      }
    }));
  }
  builder
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .setup(|app| {
      use tauri::Manager;
      let store = app.path().app_data_dir()?.join("downloads.json");
      app.manage(std::sync::Arc::new(download::DownloadState::load(store)));
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .clear_targets()
            .target(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout))
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![parse_mybatis_logs, send_http_request, download::download_list, download::download_add, download::download_control, download::download_open_folder, folder_picker::pick_download_folder, ai::save_ai_api_key, ai::delete_ai_api_key, ai::has_ai_api_key, ai::ai_chat_completion, ai::test_ai_connection])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
