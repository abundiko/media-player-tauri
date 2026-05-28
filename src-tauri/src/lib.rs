mod media_server;

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;
use tauri::State;

struct ServerPort(u16);

/// Counting semaphore to limit concurrent ffmpeg thumbnail processes.
struct ThumbSemaphore(tokio::sync::Semaphore);

/// Directory where cached thumbnails are stored.
struct ThumbCacheDir(String);

/// Tracks which video paths currently have an in-progress thumbnail extraction
/// to avoid spawning duplicate ffmpeg processes for the same file.
struct PendingThumbnails(Mutex<HashSet<String>>);

pub fn get_ffmpeg_path() -> String {
    if let Ok(mut exe_path) = std::env::current_exe() {
        exe_path.pop();
        let bin_name = if cfg!(target_os = "windows") {
            "caste-ffmpeg.exe"
        } else {
            "caste-ffmpeg"
        };
        let sidecar = exe_path.join(bin_name);
        if sidecar.exists() {
            return sidecar.to_string_lossy().to_string();
        }
    }
    "ffmpeg".to_string()
}

pub fn get_ffprobe_path() -> String {
    if let Ok(mut exe_path) = std::env::current_exe() {
        exe_path.pop();
        let bin_name = if cfg!(target_os = "windows") {
            "caste-ffprobe.exe"
        } else {
            "caste-ffprobe"
        };
        let sidecar = exe_path.join(bin_name);
        if sidecar.exists() {
            return sidecar.to_string_lossy().to_string();
        }
    }
    "ffprobe".to_string()
}

#[tauri::command]
fn is_using_system_ffmpeg() -> bool {
    get_ffmpeg_path() == "ffmpeg"
}

#[tauri::command]
fn get_stream_url(path: String, port: State<ServerPort>) -> Result<String, String> {
    let encoded = urlencoding::encode(&path);
    Ok(format!("http://127.0.0.1:{}/file?path={}", port.0, encoded))
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("File not found: {}", path));
    }
    if !is_safe_path(&path) {
        return Err(format!("Access denied: {}", path));
    }
    if !is_readable_ext(p) {
        return Err(format!("File type not allowed for reading: {}", path));
    }
    std::fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
fn get_transcode_url(path: String, seek_time: f64, speed: f64, port: State<ServerPort>) -> String {
    let encoded = urlencoding::encode(&path);
    format!(
        "http://127.0.0.1:{}/transcode?path={}&t={:.3}&s={:.3}",
        port.0, encoded, seek_time, speed
    )
}

#[tauri::command]
async fn probe_duration(path: String) -> Result<f64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let child = std::process::Command::new(get_ffprobe_path())
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                &path,
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("ffprobe failed: {}", e))?;

        let output = child
            .wait_with_output()
            .map_err(|e| format!("ffprobe wait error: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::error!("probe_duration ffprobe error: {}", stderr.trim());
            return Err(format!("ffprobe error: {}", stderr.trim()));
        }

        let s = String::from_utf8_lossy(&output.stdout);
        s.trim()
            .parse::<f64>()
            .map_err(|e| format!("parse error: {}", e))
    })
    .await
    .map_err(|e| format!("probe_duration task crashed: {}", e))?
}

#[derive(Debug, Serialize, Deserialize)]
struct SubtitleTrack {
    index: usize,
    title: String,
    language: String,
}

#[derive(Deserialize)]
struct FfprobeOutput {
    #[serde(default)]
    streams: Vec<FfprobeStream>,
}

#[derive(Deserialize)]
struct FfprobeStream {
    index: usize,
    tags: Option<std::collections::HashMap<String, String>>,
}

#[tauri::command]
async fn get_subtitle_tracks(path: String) -> Result<Vec<SubtitleTrack>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let output = std::process::Command::new(get_ffprobe_path())
            .args([
                "-v",
                "error",
                "-select_streams",
                "s",
                "-show_entries",
                "stream=index,tags",
                "-of",
                "json",
                &path,
            ])
            .output()
            .map_err(|e| format!("Failed to spawn ffprobe: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::error!("get_subtitle_tracks ffprobe error: {}", stderr.trim());
            return Err(stderr.to_string());
        }

        let parsed: FfprobeOutput = serde_json::from_slice(&output.stdout)
            .map_err(|e| format!("Failed to parse ffprobe output: {}", e))?;

        let tracks = parsed
            .streams
            .into_iter()
            .map(|s| {
                let mut title = format!("Track {}", s.index);
                let mut language = String::from("en");

                if let Some(tags) = s.tags {
                    let lower_tags: std::collections::HashMap<_, _> = tags
                        .into_iter()
                        .map(|(k, v)| (k.to_lowercase(), v))
                        .collect();
                    if let Some(t) = lower_tags.get("title") {
                        title = t.clone();
                    }
                    if let Some(l) = lower_tags.get("language") {
                        language = l.clone();
                    }
                }

                SubtitleTrack {
                    index: s.index,
                    title,
                    language,
                }
            })
            .collect();

        Ok(tracks)
    })
    .await
    .map_err(|e| format!("get_subtitle_tracks task crashed: {}", e))?
}

#[derive(Debug, Serialize, Deserialize)]
struct ScannedVideo {
    path: String,
    name: String,
    size: u64,
    modified: u64,
}

const MEDIA_EXTS: &[&str] = &[
    "mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg", "ts", "ogv", "3gp",
    "mp3", "flac", "wav", "aac", "ogg", "opus", "m4a", "wma", "ac3", "dts",
];

/// Audio-only extensions that cannot produce video thumbnails.
const AUDIO_EXTS: &[&str] = &[
    "mp3", "flac", "wav", "aac", "ogg", "opus", "m4a", "wma", "ac3", "dts",
];

fn is_audio_ext(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// File extensions allowed for `read_file_bytes` — media + subtitle formats.
const READABLE_EXTS: &[&str] = &["srt", "vtt", "ass", "ssa", "sub"];

fn is_media_ext(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| MEDIA_EXTS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn is_readable_ext(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let e = e.to_lowercase();
            MEDIA_EXTS.contains(&e.as_str()) || READABLE_EXTS.contains(&e.as_str())
        })
        .unwrap_or(false)
}

/// Canonicalize a path and verify it stays within allowed root directories.
fn is_safe_path(path: &str) -> bool {
    let p = Path::new(path);
    if !p.exists() {
        return false;
    }
    // Allow media in common user directories
    let canonical = p.canonicalize().ok();
    match canonical {
        Some(c) => {
            let c_str = c.to_string_lossy();
            !c_str.contains("/../") && !c_str.contains("/..\\")
        }
        None => false,
    }
}

#[tauri::command]
async fn get_video_metadata(path: String) -> Result<ScannedVideo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = Path::new(&path);
        if !p.exists() || !p.is_file() {
            return Err("File not found or not a file".into());
        }

        let name = p
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let meta = std::fs::metadata(p).ok();
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified = meta
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        Ok(ScannedVideo {
            path,
            name,
            size,
            modified,
        })
    })
    .await
    .map_err(|e| format!("metadata task crashed: {}", e))?
}

#[tauri::command]
async fn scan_video_folder(path: String) -> Result<Vec<ScannedVideo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut videos = Vec::new();
        scan_directory(Path::new(&path), &mut videos, 0)?;
        Ok(videos)
    })
    .await
    .map_err(|e| format!("scan task crashed: {}", e))?
}

fn scan_directory(dir: &Path, videos: &mut Vec<ScannedVideo>, depth: usize) -> Result<(), String> {
    scan_directory_impl(dir, videos, depth, &mut Vec::new())
}

fn scan_directory_impl(
    dir: &Path,
    videos: &mut Vec<ScannedVideo>,
    depth: usize,
    visited: &mut Vec<std::path::PathBuf>,
) -> Result<(), String> {
    if depth > 4 {
        return Ok(());
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();

        // Resolve symlinks to their canonical target for cycle detection
        if path.is_symlink() {
            if let Ok(target) = path.canonicalize() {
                if visited.contains(&target) {
                    continue;
                }
                if target.is_dir() {
                    visited.push(target.clone());
                    let _ = scan_directory_impl(&target, videos, depth + 1, visited);
                } else if target.is_file() && is_media_ext(&target) {
                    add_scanned_video(&target, videos);
                }
            }
            continue;
        }

        if path.is_dir() {
            let _ = scan_directory_impl(&path, videos, depth + 1, visited);
        } else if path.is_file() && is_media_ext(&path) {
            add_scanned_video(&path, videos);
        }
    }

    Ok(())
}

fn add_scanned_video(path: &Path, videos: &mut Vec<ScannedVideo>) {
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let meta = std::fs::metadata(path).ok();
    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let modified = meta
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    videos.push(ScannedVideo {
        path: path.to_string_lossy().to_string(),
        name,
        size,
        modified,
    });
}

/// Compute a stable cache filename from a video path.
fn thumb_cache_name(video_path: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    video_path.hash(&mut hasher);
    format!("{:016x}.jpg", hasher.finish())
}

/// Helper to remove a path from the pending thumbnails set.
fn clear_pending_thumb(pending: &Mutex<HashSet<String>>, path: &str) {
    if let Ok(mut set) = pending.lock() {
        set.remove(path);
    }
}

/// Generate a thumbnail for a video file. Returns an HTTP URL to the cached thumbnail.
/// Uses a tokio semaphore to limit concurrent ffmpeg processes.
#[tauri::command]
async fn get_video_thumbnail(
    path: String,
    sem: State<'_, ThumbSemaphore>,
    cache_dir: State<'_, ThumbCacheDir>,
    port: State<'_, ServerPort>,
    pending: State<'_, PendingThumbnails>,
) -> Result<String, String> {
    let cache_name = thumb_cache_name(&path);
    let cache_path = format!("{}/{}", cache_dir.0, cache_name);
    let server_port = port.0;

    // Check disk cache first — no ffmpeg needed
    if Path::new(&cache_path).exists() {
        let encoded = urlencoding::encode(&cache_path);
        return Ok(format!(
            "http://127.0.0.1:{}/thumb?path={}",
            server_port, encoded
        ));
    }

    // Dedup: skip if another request is already extracting this thumbnail
    {
        let mut in_progress = pending.0.lock().map_err(|e| format!("lock error: {}", e))?;
        if in_progress.contains(&path) {
            return Err("thumbnail extraction already in progress".into());
        }
        in_progress.insert(path.clone());
    }

    // Acquire semaphore permit (blocks asynchronously when capacity reached)
    let _permit = sem
        .0
        .acquire()
        .await
        .map_err(|e| format!("semaphore error: {}", e))?;

    // Double-check after acquiring permit
    if Path::new(&cache_path).exists() {
        clear_pending_thumb(&pending.0, &path);
        let encoded = urlencoding::encode(&cache_path);
        return Ok(format!(
            "http://127.0.0.1:{}/thumb?path={}",
            server_port, encoded
        ));
    }

    // Audio-only files have no video stream to capture — skip thumbnail
    let path_p = Path::new(&path);
    if is_audio_ext(path_p) {
        clear_pending_thumb(&pending.0, &path);
        return Err("audio files do not support thumbnails".into());
    }

    let path_clone = path.clone();
    let cache_path_clone = cache_path.clone();

    // All blocking work happens on the blocking thread pool
    let result = tauri::async_runtime::spawn_blocking(move || {
        // Try multiple seek positions — -ss BEFORE -i for fast input seeking
        let mut success = false;
        let ffmpeg_path = get_ffmpeg_path();
        for seek in ["5", "2", "0"] {
            let result = std::process::Command::new(&ffmpeg_path)
                .args([
                    "-ss",
                    seek,
                    "-i",
                    &path_clone,
                    "-vframes",
                    "1",
                    "-vf",
                    "scale=320:-1",
                    "-q:v",
                    "8",
                    "-y",
                    &cache_path_clone,
                ])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::piped())
                .output();

            if let Ok(output) = result {
                if output.status.success() && Path::new(&cache_path_clone).exists() {
                    success = true;
                    break;
                }
                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    log::error!(
                        "get_video_thumbnail ffmpeg error (seek={}): {}",
                        seek,
                        stderr.trim()
                    );
                }
            }
        }

        if success {
            Ok(())
        } else {
            Err("could not extract thumbnail".to_string())
        }
    })
    .await
    .map_err(|e| format!("thumbnail task crashed: {}", e))?;

    // Clean up pending tracking regardless of success/failure
    clear_pending_thumb(&pending.0, &path);

    result?;

    let encoded = urlencoding::encode(&cache_path);
    Ok(format!(
        "http://127.0.0.1:{}/thumb?path={}",
        server_port, encoded
    ))
}

fn ensure_cache_dir() -> String {
    let cache_dir = dirs::cache_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
        .join("caste")
        .join("thumbs");
    let _ = std::fs::create_dir_all(&cache_dir);
    cache_dir.to_string_lossy().to_string()
}

#[tauri::command]
fn get_startup_file() -> Result<Option<String>, String> {
    // The first argument is the executable path.
    // The second argument is usually the file path passed by the OS when opened via file association.
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 {
        let potential_file = &args[1];
        if Path::new(potential_file).exists() && Path::new(potential_file).is_file() {
            return Ok(Some(potential_file.clone()));
        }
    }
    Ok(None)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let server = media_server::MediaServer::start().expect("Failed to start media server");
    let cache_dir = ensure_cache_dir();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            use tauri::Emitter;
            if args.len() > 1 {
                if let Some(path) = args.get(1) {
                    if std::path::Path::new(path).exists() {
                        let _ = app.emit("file-opened", path);
                    }
                }
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(ServerPort(server.port))
        .manage(ThumbSemaphore(tokio::sync::Semaphore::new(2)))
        .manage(ThumbCacheDir(cache_dir))
        .manage(PendingThumbnails(Mutex::new(HashSet::new())))
        .invoke_handler(tauri::generate_handler![
            get_stream_url,
            read_file_bytes,
            get_transcode_url,
            probe_duration,
            get_subtitle_tracks,
            get_video_metadata,
            scan_video_folder,
            get_video_thumbnail,
            get_startup_file,
            is_using_system_ffmpeg,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
