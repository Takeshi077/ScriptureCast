use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, WebviewWindowBuilder};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_store::StoreExt;

// ── Offline Verse Lookup ────────────────────────────────────
use std::collections::HashMap;
use once_cell::sync::Lazy;

static BOOK_ABBREVIATIONS: Lazy<HashMap<&'static str, &'static str>> = Lazy::new(|| {
    let mut m = HashMap::new();
    m.insert("genesis","Genesis"); m.insert("gen","Genesis"); m.insert("ge","Genesis"); m.insert("gn","Genesis");
    m.insert("exodus","Exodus"); m.insert("exo","Exodus"); m.insert("exod","Exodus");
    m.insert("leviticus","Leviticus"); m.insert("lev","Leviticus");
    m.insert("numbers","Numbers"); m.insert("num","Numbers"); m.insert("nm","Numbers"); m.insert("nbr","Numbers");
    m.insert("deuteronomy","Deuteronomy"); m.insert("deut","Deuteronomy"); m.insert("dt","Deuteronomy");
    m.insert("joshua","Joshua"); m.insert("josh","Joshua"); m.insert("jos","Joshua");
    m.insert("judges","Judges"); m.insert("judg","Judges"); m.insert("jg","Judges"); m.insert("jdg","Judges");
    m.insert("ruth","Ruth"); m.insert("rut","Ruth");
    m.insert("1 samuel","1 Samuel"); m.insert("1 sam","1 Samuel"); m.insert("1sa","1 Samuel"); m.insert("1s","1 Samuel"); m.insert("i samuel","1 Samuel"); m.insert("i sam","1 Samuel");
    m.insert("2 samuel","2 Samuel"); m.insert("2 sam","2 Samuel"); m.insert("2sa","2 Samuel"); m.insert("2s","2 Samuel"); m.insert("ii samuel","2 Samuel"); m.insert("ii sam","2 Samuel");
    m.insert("1 kings","1 Kings"); m.insert("1 ki","1 Kings"); m.insert("1ki","1 Kings"); m.insert("1k","1 Kings"); m.insert("i kings","1 Kings"); m.insert("i ki","1 Kings");
    m.insert("2 kings","2 Kings"); m.insert("2 ki","2 Kings"); m.insert("2ki","2 Kings"); m.insert("2k","2 Kings"); m.insert("ii kings","2 Kings"); m.insert("ii ki","2 Kings");
    m.insert("1 chronicles","1 Chronicles"); m.insert("1 chron","1 Chronicles"); m.insert("1ch","1 Chronicles"); m.insert("i chronicles","1 Chronicles"); m.insert("i chron","1 Chronicles");
    m.insert("2 chronicles","2 Chronicles"); m.insert("2 chron","2 Chronicles"); m.insert("2ch","2 Chronicles"); m.insert("ii chronicles","2 Chronicles"); m.insert("ii chron","2 Chronicles");
    m.insert("ezra","Ezra"); m.insert("ezr","Ezra");
    m.insert("nehemiah","Nehemiah"); m.insert("neh","Nehemiah");
    m.insert("esther","Esther"); m.insert("esth","Esther"); m.insert("est","Esther");
    m.insert("job","Job");
    m.insert("psalms","Psalms"); m.insert("psalm","Psalms"); m.insert("psa","Psalms"); m.insert("ps","Psalms"); m.insert("pss","Psalms");
    m.insert("proverbs","Proverbs"); m.insert("prov","Proverbs"); m.insert("pro","Proverbs"); m.insert("prv","Proverbs");
    m.insert("ecclesiastes","Ecclesiastes"); m.insert("eccles","Ecclesiastes"); m.insert("ecc","Ecclesiastes");
    m.insert("song of solomon","Song of Solomon"); m.insert("song of songs","Song of Solomon"); m.insert("song","Song of Solomon"); m.insert("sos","Song of Solomon");
    m.insert("isaiah","Isaiah"); m.insert("isa","Isaiah");
    m.insert("jeremiah","Jeremiah"); m.insert("jer","Jeremiah"); m.insert("jrm","Jeremiah");
    m.insert("lamentations","Lamentations"); m.insert("lam","Lamentations");
    m.insert("ezekiel","Ezekiel"); m.insert("ezek","Ezekiel"); m.insert("ezk","Ezekiel");
    m.insert("daniel","Daniel"); m.insert("dan","Daniel"); m.insert("dn","Daniel");
    m.insert("hosea","Hosea"); m.insert("hos","Hosea");
    m.insert("joel","Joel"); m.insert("jl","Joel");
    m.insert("amos","Amos"); m.insert("amo","Amos");
    m.insert("obadiah","Obadiah"); m.insert("obad","Obadiah");
    m.insert("jonah","Jonah"); m.insert("jon","Jonah"); m.insert("jnh","Jonah");
    m.insert("micah","Micah"); m.insert("mic","Micah");
    m.insert("nahum","Nahum"); m.insert("nah","Nahum");
    m.insert("habakkuk","Habakkuk"); m.insert("hab","Habakkuk");
    m.insert("zephaniah","Zephaniah"); m.insert("zeph","Zephaniah"); m.insert("zep","Zephaniah");
    m.insert("haggai","Haggai"); m.insert("hag","Haggai");
    m.insert("zechariah","Zechariah"); m.insert("zech","Zechariah"); m.insert("zec","Zechariah");
    m.insert("malachi","Malachi"); m.insert("mal","Malachi");
    m.insert("matthew","Matthew"); m.insert("matt","Matthew"); m.insert("mat","Matthew"); m.insert("mt","Matthew");
    m.insert("mark","Mark"); m.insert("mar","Mark"); m.insert("mk","Mark"); m.insert("mrk","Mark");
    m.insert("luke","Luke"); m.insert("luk","Luke"); m.insert("lk","Luke");
    m.insert("john","John"); m.insert("joh","John"); m.insert("jn","John"); m.insert("jhn","John");
    m.insert("acts","Acts"); m.insert("act","Acts");
    m.insert("romans","Romans"); m.insert("rom","Romans"); m.insert("rm","Romans");
    m.insert("1 corinthians","1 Corinthians"); m.insert("1 cor","1 Corinthians"); m.insert("1co","1 Corinthians"); m.insert("1c","1 Corinthians"); m.insert("i corinthians","1 Corinthians"); m.insert("i cor","1 Corinthians");
    m.insert("2 corinthians","2 Corinthians"); m.insert("2 cor","2 Corinthians"); m.insert("2co","2 Corinthians"); m.insert("2c","2 Corinthians"); m.insert("ii corinthians","2 Corinthians"); m.insert("ii cor","2 Corinthians");
    m.insert("galatians","Galatians"); m.insert("gal","Galatians"); m.insert("ga","Galatians");
    m.insert("ephesians","Ephesians"); m.insert("ephes","Ephesians"); m.insert("eph","Ephesians");
    m.insert("philippians","Philippians"); m.insert("phil","Philippians"); m.insert("php","Philippians");
    m.insert("colossians","Colossians"); m.insert("col","Colossians");
    m.insert("1 thessalonians","1 Thessalonians"); m.insert("1 thess","1 Thessalonians"); m.insert("1th","1 Thessalonians"); m.insert("1t","1 Thessalonians"); m.insert("i thessalonians","1 Thessalonians"); m.insert("i thess","1 Thessalonians");
    m.insert("2 thessalonians","2 Thessalonians"); m.insert("2 thess","2 Thessalonians"); m.insert("2th","2 Thessalonians"); m.insert("2t","2 Thessalonians"); m.insert("ii thessalonians","2 Thessalonians"); m.insert("ii thess","2 Thessalonians");
    m.insert("1 timothy","1 Timothy"); m.insert("1 tim","1 Timothy"); m.insert("1ti","1 Timothy"); m.insert("1t","1 Timothy"); m.insert("i timothy","1 Timothy"); m.insert("i tim","1 Timothy");
    m.insert("2 timothy","2 Timothy"); m.insert("2 tim","2 Timothy"); m.insert("2ti","2 Timothy"); m.insert("2t","2 Timothy"); m.insert("ii timothy","2 Timothy"); m.insert("ii tim","2 Timothy");
    m.insert("titus","Titus"); m.insert("tit","Titus");
    m.insert("philemon","Philemon"); m.insert("philem","Philemon"); m.insert("phm","Philemon");
    m.insert("hebrews","Hebrews"); m.insert("hebr","Hebrews"); m.insert("heb","Hebrews");
    m.insert("james","James"); m.insert("jas","James");
    m.insert("1 peter","1 Peter"); m.insert("1 pet","1 Peter"); m.insert("1pe","1 Peter"); m.insert("1p","1 Peter"); m.insert("i peter","1 Peter"); m.insert("i pet","1 Peter");
    m.insert("2 peter","2 Peter"); m.insert("2 pet","2 Peter"); m.insert("2pe","2 Peter"); m.insert("2p","2 Peter"); m.insert("ii peter","2 Peter"); m.insert("ii pet","2 Peter");
    m.insert("1 john","1 John"); m.insert("1 jn","1 John"); m.insert("1j","1 John"); m.insert("i john","1 John"); m.insert("i jn","1 John");
    m.insert("2 john","2 John"); m.insert("2 jn","2 John"); m.insert("2j","2 John"); m.insert("ii john","2 John"); m.insert("ii jn","2 John");
    m.insert("3 john","3 John"); m.insert("3 jn","3 John"); m.insert("3j","3 John"); m.insert("iii john","3 John"); m.insert("iii jn","3 John");
    m.insert("jude","Jude"); m.insert("jud","Jude");
    m.insert("revelation","Revelation"); m.insert("rev","Revelation"); m.insert("revel","Revelation");
    m
});

#[derive(Serialize)]
struct VerseItem {
    verse: i32,
    text: String,
}

#[derive(Serialize)]
struct VerseResult {
    reference: String,
    book: String,
    chapter: i32,
    verses: Vec<VerseItem>,
    combined_text: String,
}

fn get_bible_db_path(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join("bible.db");
        if p.exists() { return p; }
    }
    let cwd = std::env::current_dir().unwrap_or_default();
    let p = cwd.join("data").join("bible.db");
    if p.exists() { return p; }
    if let Some(parent) = cwd.parent() {
        let p = parent.join("data").join("bible.db");
        if p.exists() { return p; }
    }
    cwd.join("data").join("bible.db")
}

fn parse_verse_text(text: &str) -> Option<(String, i32, Option<i32>, Option<i32>)> {
    let lower = text.to_lowercase().trim().to_string();
    if lower.is_empty() { return None; }

    let mut matched_book: Option<&str> = None;
    let mut after_book = String::new();
    let words: Vec<&str> = lower.split_whitespace().collect();

    for i in (1..=words.len().min(3)).rev() {
        let candidate = words[..i].join(" ");
        if let Some(full) = BOOK_ABBREVIATIONS.get(candidate.as_str()) {
            matched_book = Some(full);
            after_book = words[i..].join(" ");
            break;
        }
    }

    let book = matched_book.map(|s| s.to_string())?;
    let rest = after_book.trim();
    if rest.is_empty() { return None; }

    // "chapter 3:16-20" or "3:16-20"
    let range_re = regex::Regex::new(r"^(?:chapter\s+)?(\d+)\s*:\s*(\d+)\s*(?:-|to)\s*(\d+)$").ok()?;
    if let Some(caps) = range_re.captures(rest) {
        return Some((book,
            caps.get(1)?.as_str().parse().ok()?,
            Some(caps.get(2)?.as_str().parse().ok()?),
            Some(caps.get(3)?.as_str().parse().ok()?)));
    }

    // "chapter 3:16" or "3:16"
    let colon_re = regex::Regex::new(r"^(?:chapter\s+)?(\d+)\s*:\s*(\d+)$").ok()?;
    if let Some(caps) = colon_re.captures(rest) {
        return Some((book,
            caps.get(1)?.as_str().parse().ok()?,
            Some(caps.get(2)?.as_str().parse().ok()?),
            None));
    }

    // "chapter 3 verse 16" or "3 verse 16" or "3 vs 16" or "3 v 16"
    let verse_word_re = regex::Regex::new(r"^(?:chapter\s+)?(\d+)\s+(?:verse|vs\.?|v\.?)\s+(\d+)(?:\s*(?:-|to)\s*(\d+))?$").ok()?;
    if let Some(caps) = verse_word_re.captures(rest) {
        return Some((book,
            caps.get(1)?.as_str().parse().ok()?,
            Some(caps.get(2)?.as_str().parse().ok()?),
            caps.get(3).and_then(|m| m.as_str().parse::<i32>().ok())));
    }

    // "chapter 3" or "3" (just a chapter number)
    let chapter_re = regex::Regex::new(r"^(?:chapter\s+)?(\d+)$").ok()?;
    if let Some(caps) = chapter_re.captures(rest) {
        return Some((book, caps.get(1)?.as_str().parse().ok()?, None, None));
    }

    None
}

#[tauri::command]
async fn lookup_verse(
    app: tauri::AppHandle,
    book: String,
    chapter: i32,
    verse_start: Option<i32>,
    verse_end: Option<i32>,
    translation: Option<String>,
) -> Result<VerseResult, String> {
    let db_path = get_bible_db_path(&app);
    let conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("Cannot open bible.db: {}", e))?;

    let trans = translation.as_deref().unwrap_or("KJV");
    let vs = verse_start.unwrap_or(1);
    let ve = verse_end.unwrap_or(vs);

    let reference = if verse_end.is_some() && ve != vs {
        format!("{} {}:{}-{} ({})", book, chapter, vs, ve, trans)
    } else {
        format!("{} {}:{} ({})", book, chapter, vs, trans)
    };

    let mut sql = String::from(
        "SELECT verse, text FROM scriptures WHERE translation = ?1 AND book = ?2 AND chapter = ?3",
    );

    if verse_end.is_some() && ve != vs {
        sql += " AND verse >= ?4 AND verse <= ?5 ORDER BY verse ASC";
    } else {
        sql += " AND verse = ?4 ORDER BY verse ASC";
    }

    let mut stmt = conn.prepare(&sql).map_err(|e| format!("SQL prepare: {}", e))?;

    let rows = stmt
        .query_map(rusqlite::params![trans, book, chapter, vs, ve], |row| {
            Ok(VerseItem {
                verse: row.get(0)?,
                text: row.get(1)?,
            })
        })
        .map_err(|e| format!("SQL query: {}", e))?;

    let mut verses = Vec::new();
    for row in rows {
        verses.push(row.map_err(|e| format!("Row: {}", e))?);
    }

    if verses.is_empty() {
        return Ok(VerseResult {
            reference,
            book: book.clone(),
            chapter,
            verses: vec![],
            combined_text: "Scripture reference not found in translation.".to_string(),
        });
    }

    let combined_text = verses
        .iter()
        .map(|v| v.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");

    Ok(VerseResult {
        reference,
        book,
        chapter,
        verses,
        combined_text,
    })
}

#[tauri::command]
async fn lookup_verse_text(
    app: tauri::AppHandle,
    text: String,
    translation: Option<String>,
) -> Result<VerseResult, String> {
    let (book, chapter, verse_start, verse_end) = parse_verse_text(&text)
        .ok_or_else(|| "Could not parse scripture reference from text.".to_string())?;

    lookup_verse(app, book, chapter, verse_start, verse_end, translation).await
}

#[tauri::command]
async fn offline_db_available(app: tauri::AppHandle) -> bool {
    get_bible_db_path(&app).exists()
}

struct SemanticServer {
    process: Mutex<Option<Child>>,
    port: Mutex<Option<u16>>,
}

struct ProjectorState {
    window_label: Mutex<Option<String>>,
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
        .local_data_dir()
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
    app: tauri::AppHandle,
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
        .unwrap_or_else(|| get_models_dir(&app).join(MODEL_FILENAME));

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
            "-of",
            audio_path.to_str().unwrap(),
            "-nt",
            "-np",
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run whisper: {}", e))?;

    let json_path = PathBuf::from(format!("{}.json", audio_path.to_string_lossy()));

    // Try success path regardless of exit code — whisper-cli exits 0 even on errors
    if let Ok(json_str) = std::fs::read_to_string(&json_path) {
        if let Ok(result) = serde_json::from_str::<serde_json::Value>(&json_str) {
            let text = result["transcription"][0]["text"]
                .as_str()
                .unwrap_or("")
                .to_string();
            let _ = std::fs::remove_file(&audio_path);
            let _ = std::fs::remove_file(&json_path);
            return Ok(text);
        }
    }

    // Fallback: report error with full diagnostics
    let _ = std::fs::remove_file(&audio_path);
    let _ = std::fs::remove_file(&json_path);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    Err(format!(
        "whisper failed (exit: {:?})\nstderr: {}\nstdout: {}",
        output.status.code(),
        stderr,
        stdout
    ))
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

#[derive(Serialize)]
struct DisplayInfoWithId {
    id: String,
    name: Option<String>,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    is_primary: bool,
}

#[tauri::command]
async fn get_available_displays(app: tauri::AppHandle) -> Result<Vec<DisplayInfoWithId>, String> {
    let primary = app.primary_monitor().map_err(|e| e.to_string())?;
    let all = app.available_monitors().map_err(|e| e.to_string())?;
    Ok(all
        .into_iter()
        .enumerate()
        .map(|(i, m)| {
            let pos = m.position();
            let size = m.size();
            let is_primary = primary.as_ref().map_or(false, |p| {
                p.position().x == pos.x
                    && p.position().y == pos.y
                    && p.size().width == size.width
                    && p.size().height == size.height
            });
            DisplayInfoWithId {
                id: format!("display-{}", i + 1),
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

#[tauri::command]
async fn open_projector_on_display(
    app: tauri::AppHandle,
    state: tauri::State<'_, ProjectorState>,
    display_id: String,
) -> Result<(), String> {
    // Close existing projector window if open
    {
        let label = state.window_label.lock().unwrap().clone();
        if let Some(ref label) = label {
            if let Some(window) = app.get_webview_window(label) {
                let _ = window.close();
            }
        }
    }

    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let idx: usize = display_id
        .strip_prefix("display-")
        .and_then(|s| s.parse().ok())
        .and_then(|i: usize| i.checked_sub(1))
        .unwrap_or(0);
    let monitor = monitors.get(idx).ok_or_else(|| "Display not found".to_string())?;

    let pos = monitor.position();
    let size = monitor.size();
    let server_url = get_server_url(&app);
    let url = format!("{}/screen", server_url.trim_end_matches('/'));
    println!("DEBUG: Loading projector URL: {}", url);

    let label = "projector";

    if let Some(w) = app.get_webview_window(label) {
        let _ = w.close();
    }

    WebviewWindowBuilder::new(
        &app,
        label,
        tauri::WebviewUrl::External(tauri::Url::parse(&url).map_err(|e| e.to_string())?),
    )
    .position(pos.x as f64, pos.y as f64)
    .inner_size(size.width as f64, size.height as f64)
    .decorations(false)
    .fullscreen(true)
    .resizable(false)
    .title("ScriptureCast Projector")
    .build()
    .map_err(|e| e.to_string())?;

    *state.window_label.lock().unwrap() = Some(label.to_string());
    Ok(())
}

#[tauri::command]
async fn close_projector_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, ProjectorState>,
) -> Result<(), String> {
    let label = state.window_label.lock().unwrap().clone();
    if let Some(ref label) = label {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.close();
        }
    }
    *state.window_label.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
async fn identify_displays(app: tauri::AppHandle) -> Result<(), String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let server_url = get_server_url(&app);

    let mut labels = Vec::new();
    for (i, monitor) in monitors.iter().enumerate() {
        let label = format!("identify-{}", i + 1);
        let url = format!("{}/identify?n={}", server_url, i + 1);

        let pos = monitor.position();
        let size = monitor.size();
        let w = (size.width as f64).min(800.0);
        let h = (size.height as f64).min(600.0);
        let x = pos.x as f64 + (size.width as f64 - w) / 2.0;
        let y = pos.y as f64 + (size.height as f64 - h) / 2.0;

        WebviewWindowBuilder::new(
            &app,
            &label,
            tauri::WebviewUrl::External(
                tauri::Url::parse(&url).map_err(|e| e.to_string())?,
            ),
        )
        .position(x, y)
        .inner_size(w, h)
        .decorations(false)
        .resizable(false)
        .title("Identify Display")
        .build()
        .map_err(|e| e.to_string())?;

        labels.push(label);
    }

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        for label in &labels {
            if let Some(window) = app_clone.get_webview_window(label) {
                let _ = window.close();
            }
        }
    });

    Ok(())
}

fn get_server_url(app: &tauri::AppHandle) -> String {
    app.config()
        .build
        .dev_url
        .as_ref()
        .map(|u| u.to_string())
        .or_else(|| std::env::var("SCRIPTURECAST_URL").ok())
        .unwrap_or_else(|| "https://scripturecast.onrender.com".into())
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
        let port = state.port.lock().unwrap();
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
        .manage(ProjectorState {
            window_label: Mutex::new(None),
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
            get_available_displays,
            open_projector_on_display,
            close_projector_window,
            identify_displays,
            lookup_verse,
            lookup_verse_text,
            offline_db_available,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
