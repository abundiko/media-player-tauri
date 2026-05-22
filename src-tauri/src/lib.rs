mod media_server;

use std::path::Path;
use tauri::State;
use serde::{Deserialize, Serialize};

struct ServerPort(u16);

#[tauri::command]
fn get_stream_url(path: String, port: State<ServerPort>) -> Result<String, String> {
    let encoded = urlencoding::encode(&path);
    Ok(format!("http://127.0.0.1:{}/file?path={}", port.0, encoded))
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    if !Path::new(&path).exists() {
        return Err(format!("File not found: {}", path));
    }
    std::fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
fn get_transcode_url(path: String, seek_time: f64, speed: f64, port: State<ServerPort>) -> String {
    let encoded = urlencoding::encode(&path);
    format!("http://127.0.0.1:{}/transcode?path={}&t={:.3}&s={:.3}", port.0, encoded, seek_time, speed)
}

#[tauri::command]
fn probe_duration(path: String) -> Result<f64, String> {
    let output = std::process::Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            &path,
        ])
        .output()
        .map_err(|e| format!("ffprobe failed: {}", e))?;

    let s = String::from_utf8_lossy(&output.stdout);
    s.trim().parse::<f64>().map_err(|e| format!("parse error: {}", e))
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
fn get_subtitle_tracks(path: String) -> Result<Vec<SubtitleTrack>, String> {
    let output = std::process::Command::new("ffprobe")
        .args([
            "-v", "error",
            "-select_streams", "s",
            "-show_entries", "stream=index,tags",
            "-of", "json",
            &path,
        ])
        .output()
        .map_err(|e| format!("Failed to spawn ffprobe: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let parsed: FfprobeOutput = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse ffprobe output: {}", e))?;

    let tracks = parsed.streams.into_iter().map(|s| {
        let mut title = format!("Track {}", s.index);
        let mut language = String::from("en");

        if let Some(tags) = s.tags {
            let lower_tags: std::collections::HashMap<_, _> = tags.into_iter().map(|(k, v)| (k.to_lowercase(), v)).collect();
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
    }).collect();

    Ok(tracks)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let server = media_server::MediaServer::start().expect("Failed to start media server");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ServerPort(server.port))
        .invoke_handler(tauri::generate_handler![get_stream_url, read_file_bytes, get_transcode_url, probe_duration, get_subtitle_tracks])
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
