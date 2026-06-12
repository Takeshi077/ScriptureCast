use tauri::Manager;

fn get_server_url() -> String {
    std::env::var("SCRIPTURECAST_URL")
        .unwrap_or_else(|_| "http://localhost:8000".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let server_url = get_server_url();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                let url = tauri::Url::parse(&server_url)
                    .expect("Invalid SCRIPTURECAST_URL");
                window.navigate(url);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
