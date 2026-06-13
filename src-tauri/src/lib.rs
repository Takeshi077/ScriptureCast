use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

const MODEL_FILENAME: &str = "ggml-base.bin";

struct WhisperState {
    model_path: Mutex<Option<PathBuf>>,
}

#[derive(Serialize)]
struct WhisperStatus {
    available: bool,
    model_exists: bool,
    model_path: Option<String>,
    sidecar_exists: bool,
}

fn get_models_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("models");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

#[tauri::command]
async fn check_whisper(app: tauri::AppHandle, state: tauri::State<'_, WhisperState>) -> Result<WhisperStatus, String> {
    let model_path = state
        .model_path
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_else(|| get_models_dir(&app).join(MODEL_FILENAME));

    let model_exists = model_path.exists();

    let sidecar_exists = app
        .shell()
        .sidecar("whisper-cli")
        .map(|_| true)
        .unwrap_or(false);

    Ok(WhisperStatus {
        available: sidecar_exists && model_exists,
        model_exists,
        model_path: Some(model_path.to_string_lossy().to_string()),
        sidecar_exists,
    })
}

#[tauri::command]
async fn set_whisper_model_path(
    state: tauri::State<'_, WhisperState>,
    path: String,
) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("Model not found at: {}", path));
    }
    *state.model_path.lock().unwrap() = Some(p);
    Ok(())
}

#[tauri::command]
async fn write_model_file(
    state: tauri::State<'_, WhisperState>,
    data_base64: String,
) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_base64)
        .map_err(|e| format!("Base64 decode failed: {}", e))?;

    let model_path = state
        .model_path
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_else(|| {
            let dir = PathBuf::from(".").join("models");
            let _ = std::fs::create_dir_all(&dir);
            dir.join(MODEL_FILENAME)
        });

    if let Some(parent) = model_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&model_path, &bytes).map_err(|e| e.to_string())?;

    *state.model_path.lock().unwrap() = Some(model_path.clone());
    Ok(model_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn transcribe_audio(
    app: tauri::AppHandle,
    state: tauri::State<'_, WhisperState>,
    audio_base64: String,
) -> Result<String, String> {
    use base64::Engine;
    let audio_bytes = base64::engine::general_purpose::STANDARD
        .decode(&audio_base64)
        .map_err(|e| format!("Base64 decode failed: {}", e))?;

    let temp_dir = std::env::temp_dir().join("scripturecast");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    let audio_path = temp_dir.join(format!("{}.wav", uuid::Uuid::new_v4()));
    std::fs::write(&audio_path, &audio_bytes).map_err(|e| e.to_string())?;

    let model_path = state
        .model_path
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_else(|| get_models_dir(&app).join(MODEL_FILENAME));

    if !model_path.exists() {
        let _ = std::fs::remove_file(&audio_path);
        return Err("Whisper model not found. Download one first.".into());
    }

    let output = app
        .shell()
        .sidecar("whisper-cli")
        .map_err(|e| format!("Sidecar not found: {}", e))?
        .args([
            "-f",
            audio_path.to_str().unwrap(),
            "-m",
            model_path.to_str().unwrap(),
            "-oj",
            "-nt",
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run whisper: {}", e))?;

    let _ = std::fs::remove_file(&audio_path);

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let result: serde_json::Value =
            serde_json::from_str(&stdout).map_err(|e| format!("JSON parse: {}", e))?;
        let text = result["text"].as_str().unwrap_or("").to_string();
        Ok(text)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("whisper failed: {}", stderr))
    }
}

fn get_server_url(app: &tauri::AppHandle) -> String {
    app.config()
        .build
        .dev_url
        .as_ref()
        .map(|u| u.to_string())
        .or_else(|| std::env::var("SCRIPTURECAST_URL").ok())
        .unwrap_or_else(|| "http://localhost:8000".into())
}

#[tauri::command]
async fn get_server_url_cmd(app: tauri::AppHandle) -> String {
    get_server_url(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(WhisperState {
            model_path: Mutex::new(None),
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let url_str = get_server_url(app.handle());
                if let Ok(url) = tauri::Url::parse(&url_str) {
                    let _ = window.navigate(url);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_whisper,
            set_whisper_model_path,
            write_model_file,
            transcribe_audio,
            get_server_url_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
