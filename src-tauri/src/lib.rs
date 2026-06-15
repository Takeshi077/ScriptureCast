use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_store::StoreExt;

struct SemanticServer {
    process: Mutex<Option<Child>>,
    port: Mutex<Option<u16>>,
}

impl Drop for SemanticServer {
    fn drop(&mut self) {
        if let Ok(mut p) = self.process.lock() {
            if let Some(ref mut child) = *p {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

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

    // Point working dir at the DLLs so whisper-cli finds them (dev: src-tauri/binaries, prod: resources/binaries)
    let dll_dir = app
        .path()
        .resource_dir()
        .map(|d| d.join("binaries"))
        .unwrap_or_else(|_| {
            std::env::current_dir()
                .unwrap_or_default()
                .join("src-tauri")
                .join("binaries")
        });

    let output = app
        .shell()
        .sidecar("whisper-cli")
        .map_err(|e| format!("Sidecar not found: {}", e))?
        .current_dir(dll_dir)
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

#[derive(Serialize)]
struct DisplayInfo {
    name: Option<String>,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    is_primary: bool,
}

#[tauri::command]
async fn get_displays(app: tauri::AppHandle) -> Result<Vec<DisplayInfo>, String> {
    let primary = app.primary_monitor().map_err(|e| e.to_string())?;
    let all = app.available_monitors().map_err(|e| e.to_string())?;
    Ok(all
        .into_iter()
        .map(|m| {
            let pos = m.position();
            let size = m.size();
            let is_primary = primary.as_ref().map_or(false, |p| {
                p.position().x == pos.x
                    && p.position().y == pos.y
                    && p.size().width == size.width
                    && p.size().height == size.height
            });
            DisplayInfo {
                name: m.name().map(|s| s.to_string()),
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
                is_primary,
            }
        })
        .collect())
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

#[tauri::command]
async fn set_auth_token(app: tauri::AppHandle, token: String) -> Result<(), String> {
    let store = app.store("auth.json").map_err(|e| e.to_string())?;
    store.set("token", serde_json::Value::String(token));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_auth_token(app: tauri::AppHandle) -> Result<String, String> {
    let store = app.store("auth.json").map_err(|e| e.to_string())?;
    store
        .get("token")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .ok_or_else(|| "No token found".into())
}

#[tauri::command]
async fn remove_auth_token(app: tauri::AppHandle) -> Result<(), String> {
    let store = app.store("auth.json").map_err(|e| e.to_string())?;
    store.delete("token");
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn start_semantic_server(app: tauri::AppHandle, state: tauri::State<'_, SemanticServer>) -> Result<u16, String> {
    {
        let mut port = state.port.lock().unwrap();
        if let Some(p) = *port {
            return Ok(p);
        }
    }

    let backend_dir = app.path().resource_dir()
        .map_err(|e| format!("Resource dir: {}", e))?
        .join("backend");
    let script = backend_dir.join("semantic_server.py");

    let script = if script.exists() {
        script
    } else {
        // fallback: relative to CWD (dev mode)
        let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
        cwd.join("backend").join("semantic_server.py")
    };

    if !script.exists() {
        return Err("semantic_server.py not found".into());
    }

    for python_cmd in &["python3", "python"] {
        if Command::new(python_cmd).arg("--version").output().is_err() {
            continue;
        }

        let mut child = Command::new(python_cmd)
            .arg(&script)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Spawn: {}", e))?;

        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            if let Some(Ok(line)) = reader.lines().next() {
                if let Some(port_str) = line.trim().strip_prefix("SEMANTIC_READY:") {
                    if let Ok(port) = port_str.parse::<u16>() {
                        *state.port.lock().unwrap() = Some(port);
                        *state.process.lock().unwrap() = Some(child);
                        return Ok(port);
                    }
                }
            }
        }
        let _ = child.kill();
        let _ = child.wait();
    }

    Err("Failed to start semantic server (install Python + scikit-learn)".into())
}

#[tauri::command]
async fn stop_semantic_server(state: tauri::State<'_, SemanticServer>) -> Result<(), String> {
    let mut proc = state.process.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut child) = *proc {
        let _ = child.kill();
        let _ = child.wait();
    }
    *proc = None;
    *state.port.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(WhisperState {
            model_path: Mutex::new(None),
        })
        .manage(SemanticServer {
            process: Mutex::new(None),
            port: Mutex::new(None),
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(url) = tauri::Url::parse("https://scripturecast.onrender.com") {
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
            set_auth_token,
            get_auth_token,
            remove_auth_token,
            start_semantic_server,
            stop_semantic_server,
            get_displays,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
