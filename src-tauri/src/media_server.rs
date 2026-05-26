use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tiny_http::{Header, Method, Response, Server, StatusCode};

fn mime_type(path: &str) -> &str {
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "mp4" | "m4v" | "m4a" => "video/mp4",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "mov" => "video/quicktime",
        "wmv" => "video/x-ms-wmv",
        "flv" => "video/x-flv",
        "webm" => "video/webm",
        "mpg" | "mpeg" => "video/mpeg",
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "aac" => "audio/aac",
        "ogg" | "opus" => "audio/ogg",
        "wma" => "audio/x-ms-wma",
        "ac3" => "audio/ac3",
        "dts" => "audio/vnd.dts",
        _ => "application/octet-stream",
    }
}

fn ct_header(mime: &str) -> Header {
    Header::from_bytes(b"Content-Type", mime.as_bytes()).unwrap()
}

/// Common headers added to every response for cross-origin access and caching.
fn common_headers() -> Vec<Header> {
    vec![
        Header::from_bytes(b"Accept-Ranges", b"bytes").unwrap(),
        Header::from_bytes(b"Access-Control-Allow-Origin", b"*").unwrap(),
        Header::from_bytes(b"Access-Control-Allow-Methods", b"GET, HEAD, OPTIONS").unwrap(),
        Header::from_bytes(b"Access-Control-Allow-Headers", b"Range").unwrap(),
        Header::from_bytes(b"Access-Control-Expose-Headers", b"Content-Range, Content-Length, Accept-Ranges").unwrap(),
        Header::from_bytes(b"Cache-Control", b"no-cache").unwrap(),
    ]
}

fn kill_child(mut child: Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[allow(clippy::needless_pass_by_value)]
fn handle_request(
    request: tiny_http::Request,
    transcode_children: Arc<Mutex<HashMap<String, (u32, Child)>>>,
) {
    // Handle CORS preflight
    if *request.method() == Method::Options {
        let resp = Response::new(
            StatusCode(204),
            common_headers(),
            std::io::empty(),
            Some(0),
            None,
        );
        let _ = request.respond(resp);
        return;
    }

    let url = request.url().to_string();

    // Route /transcode requests to the transcode handler
    if url.starts_with("/transcode?") {
        handle_transcode(request, &url, transcode_children);
        return;
    }

    // Route /subtitle requests to the subtitle handler
    if url.starts_with("/subtitle?") {
        handle_subtitle(request, &url);
        return;
    }

    // Route /thumb requests to serve cached thumbnail images
    if url.starts_with("/thumb?") {
        handle_thumb(request, &url);
        return;
    }

    let decoded = urlencoding::decode(&url).unwrap_or_default();
    let file_path = decoded
        .strip_prefix("/file?path=")
        .or_else(|| decoded.strip_prefix("/"))
        .map(|s| s.to_string())
        .unwrap_or_default();

    if file_path.is_empty() || !Path::new(&file_path).exists() {
        let resp = Response::from_string("Not Found").with_status_code(404);
        let _ = request.respond(resp);
        return;
    }

    let metadata = match std::fs::metadata(&file_path) {
        Ok(m) => m,
        Err(_) => {
            let resp = Response::from_string("Error").with_status_code(500);
            let _ = request.respond(resp);
            return;
        }
    };

    let file_len = metadata.len();
    let mime = mime_type(&file_path);
    let ct = ct_header(mime);

    let range = request
        .headers()
        .iter()
        .find(|h| h.field.to_string().to_lowercase() == "range")
        .map(|h| h.value.to_string());

    if let Some(ref range_val) = range {
        if let Some(bytes_range) = range_val.strip_prefix("bytes=") {
            let parts: Vec<&str> = bytes_range.splitn(2, '-').collect();
            let start: u64 = parts[0].parse().unwrap_or(0);
            let end = parts
                .get(1)
                .and_then(|s| if s.is_empty() { None } else { s.parse::<u64>().ok() })
                // Open-ended range: serve from `start` to end-of-file.
                // The browser manages its own buffering and will close the
                // connection when it has enough data. This is critical for
                // large MP4 files whose moov atom sits at the end and can
                // exceed 10-50 MB — capping the response would prevent the
                // browser from fully parsing the video track metadata.
                .unwrap_or(file_len.saturating_sub(1));

            // Clamp to valid file bounds
            let end = end.min(file_len.saturating_sub(1));
            let start = start.min(end);

            let chunk_len = end - start + 1;
            let cr_value = format!("bytes {}-{}/{}", start, end, file_len);

            let mut file = match File::open(&file_path) {
                Ok(f) => f,
                Err(_) => return,
            };
            if let Err(_) = file.seek(SeekFrom::Start(start)) {
                let resp = Response::from_string("Seek Error").with_status_code(500);
                let _ = request.respond(resp);
                return;
            }

            let mut headers = common_headers();
            headers.push(ct);
            headers.push(
                Header::from_bytes(b"Content-Range", cr_value.as_bytes()).unwrap(),
            );

            let resp = Response::new(
                StatusCode(206),
                headers,
                file.take(chunk_len),
                Some(chunk_len as usize),
                None,
            )
            .with_chunked_threshold(usize::MAX);

            let _ = request.respond(resp);
            return;
        }
    }

    // No Range header — stream entire file as 200.
    let file = match File::open(&file_path) {
        Ok(f) => f,
        Err(_) => return,
    };

    let mut headers = common_headers();
    headers.push(ct);

    let resp = Response::new(
        StatusCode(200),
        headers,
        file,
        Some(file_len as usize),
        None,
    )
    .with_chunked_threshold(usize::MAX);

    let _ = request.respond(resp);
}

/// Build FFmpeg audio filter chain for atempo, handling the 0.5–2.0 limit.
fn speed_audio_filter(speed: f64) -> String {
    if speed == 1.0 {
        return String::new();
    }
    let mut parts = Vec::new();
    let mut s = speed;
    while s > 2.0 {
        parts.push("atempo=2.0".to_string());
        s /= 2.0;
    }
    while s < 0.5 {
        parts.push("atempo=0.5".to_string());
        s /= 0.5;
    }
    parts.push(format!("atempo={:.4}", s));
    parts.join(",")
}

/// Transcode video on-the-fly via FFmpeg to H.264 fragmented MP4.
/// URL format: /transcode?path=<url-encoded-path>&t=<seek-seconds>&s=<speed>
fn handle_transcode(
    request: tiny_http::Request,
    url: &str,
    transcode_children: Arc<Mutex<HashMap<String, (u32, Child)>>>,
) {
    let query = url.strip_prefix("/transcode?").unwrap_or("");
    let mut path = String::new();
    let mut seek_secs: f64 = 0.0;
    let mut speed: f64 = 1.0;

    for param in query.split('&') {
        if let Some(val) = param.strip_prefix("path=") {
            path = urlencoding::decode(val).unwrap_or_default().to_string();
        } else if let Some(val) = param.strip_prefix("t=") {
            seek_secs = val.parse().unwrap_or(0.0);
        } else if let Some(val) = param.strip_prefix("s=") {
            speed = val.parse().unwrap_or(1.0);
        }
    }

    if path.is_empty() || !Path::new(&path).exists() {
        let resp = Response::from_string("Not Found").with_status_code(404);
        let _ = request.respond(resp);
        return;
    }

    // Kill any existing FFmpeg child for this file path (e.g. from a previous seek)
    {
        let mut map = transcode_children.lock().unwrap();
        if let Some((_pid, old)) = map.remove(&path) {
            std::thread::spawn(|| kill_child(old));
        }
    }

    let mut args: Vec<String> = vec![
        "-hide_banner".into(), "-loglevel".into(), "error".into(),
    ];
    if seek_secs > 0.0 {
        // Coarse input seek: jump to ~1s before target for speed
        let coarse = (seek_secs - 1.0).max(0.0);
        args.extend(["-ss".into(), format!("{:.3}", coarse)]);
    }
    args.extend([
        "-i".into(), path.clone(),
    ]);
    if seek_secs > 0.0 {
        // Fine output seek: frame-accurate cut at the exact target
        // Prevents AAC encoder priming artifacts (beep/glitch on seek)
        let fine = seek_secs - (seek_secs - 1.0).max(0.0);
        args.extend(["-ss".into(), format!("{:.3}", fine)]);
    }
    args.extend([
        "-c:v".into(), "libx264".into(),
        "-preset".into(), "ultrafast".into(),
        "-tune".into(), "zerolatency".into(),
        "-crf".into(), "23".into(),
    ]);
    if speed != 1.0 {
        args.extend(["-vf".into(), format!("setpts=PTS/{:.4}", speed)]);
        let afilter = speed_audio_filter(speed);
        if !afilter.is_empty() {
            args.extend(["-af".into(), afilter]);
        }
    }
    args.extend([
        "-c:a".into(), "aac".into(),
        "-b:a".into(), "128k".into(),
        "-f".into(), "mp4".into(),
        "-movflags".into(), "frag_keyframe+empty_moov+default_base_moof".into(),
        "pipe:1".into(),
    ]);

    let mut child = match Command::new(crate::get_ffmpeg_path())
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            let msg = format!("ffmpeg failed: {}", e);
            let resp = Response::from_string(msg).with_status_code(500);
            let _ = request.respond(resp);
            return;
        }
    };

    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => return,
    };

    // Store the child in the shared map so it can be killed on re-seek.
    // Remember our process ID so the cleanup below can verify it hasn't been
    // replaced by a newer seek before killing.
    let my_pid = child.id();
    transcode_children.lock().unwrap().insert(path.clone(), (my_pid, child));

    let mut headers = common_headers();
    headers.push(ct_header("video/mp4"));

    let resp = Response::new(StatusCode(200), headers, stdout, None, None);
    let _ = request.respond(resp);

    // Response stream finished (client disconnected or transcoding completed).
    // Only remove and kill the child if it is still OUR process (same PID).
    // A newer seek may have already replaced the entry with a fresh FFmpeg
    // process — killing that one would be a race-condition bug.
    {
        let mut map = transcode_children.lock().unwrap();
        if let Some((stored_pid, _)) = map.get(&path) {
            if *stored_pid == my_pid {
                let (_, child) = map.remove(&path).unwrap();
                // kill on a background thread to avoid blocking the handler
                std::thread::spawn(|| kill_child(child));
            }
        }
    }
}

pub struct MediaServer {
    pub port: u16,
    running: Arc<AtomicBool>,
    transcode_children: Arc<Mutex<HashMap<String, (u32, Child)>>>,
}

impl MediaServer {
    pub fn start() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let server = Server::http("127.0.0.1:0")?;
        let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(0);
        let running = Arc::new(AtomicBool::new(true));
        let running_clone = running.clone();
        let transcode_children: Arc<Mutex<HashMap<String, (u32, Child)>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let children_for_thread = transcode_children.clone();
        std::thread::spawn(move || {
            loop {
                if !running_clone.load(Ordering::Relaxed) {
                    break;
                }

                let request = match server.recv_timeout(std::time::Duration::from_millis(200)) {
                    Ok(Some(r)) => r,
                    Ok(None) => continue,
                    Err(e) => {
                        log::error!("media_server: recv error: {:?}", e);
                        break;
                    }
                };

                let children = children_for_thread.clone();
                std::thread::spawn(|| {
                    handle_request(request, children);
                });
            }
        });

        Ok(MediaServer { port, running, transcode_children })
    }
}

impl Drop for MediaServer {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
        let children: Vec<Child> = {
            let mut map = self.transcode_children.lock().unwrap();
            map.drain().map(|(_, (_pid, c))| c).collect()
        };
        for child in children {
            kill_child(child);
        }
    }
}

fn handle_subtitle(request: tiny_http::Request, url: &str) {
    let mut path = String::new();
    let mut track_idx = String::new();

    let query = url.split('?').nth(1).unwrap_or("");
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        let key = parts.next().unwrap_or("");
        let val = parts.next().unwrap_or("");
        if key == "path" {
            path = urlencoding::decode(val).unwrap_or_default().to_string();
        } else if key == "track" {
            track_idx = val.to_string();
        }
    }

    if path.is_empty() || track_idx.is_empty() || !Path::new(&path).exists() {
        let _ = request.respond(Response::from_string("Bad Request").with_status_code(400));
        return;
    }

    let mut cmd = Command::new(crate::get_ffmpeg_path());
    cmd.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &path,
        "-map",
        &format!("0:{}", track_idx),
        "-f",
        "webvtt",
        "pipe:1",
    ]);

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            log::error!("handle_subtitle: failed to spawn ffmpeg: {}", e);
            let _ = request.respond(Response::from_string("FFmpeg Error").with_status_code(500));
            return;
        }
    };

    let stdout = child.stdout.take().expect("Failed to open stdout");

    // Log stderr in a background thread so we can debug ffmpeg failures
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let mut buf = String::new();
            let _ = std::io::BufReader::new(stderr).read_to_string(&mut buf);
            if !buf.is_empty() {
                log::error!("handle_subtitle ffmpeg stderr: {}", buf.trim());
            }
        });
    }

    let mut headers = common_headers();
    headers.push(Header::from_bytes(b"Content-Type", b"text/vtt").unwrap());

    let resp = Response::new(
        StatusCode(200),
        headers,
        stdout,
        None,
        None,
    );

    let _ = request.respond(resp);

    // Always kill the child after the response stream ends.
    // If the client disconnected early, ffmpeg may still be running;
    // kill() is harmless if it already exited.
    kill_child(child);
}

/// Serve a cached thumbnail image from disk.
fn handle_thumb(request: tiny_http::Request, url: &str) {
    let query = url.split('?').nth(1).unwrap_or("");
    let mut thumb_path = String::new();

    for pair in query.split('&') {
        if let Some(val) = pair.strip_prefix("path=") {
            thumb_path = urlencoding::decode(val).unwrap_or_default().to_string();
        }
    }

    if thumb_path.is_empty() || !Path::new(&thumb_path).exists() {
        let _ = request.respond(Response::from_string("Not Found").with_status_code(404));
        return;
    }

    let file = match File::open(&thumb_path) {
        Ok(f) => f,
        Err(_) => {
            let _ = request.respond(Response::from_string("Error").with_status_code(500));
            return;
        }
    };

    let file_len = std::fs::metadata(&thumb_path).map(|m| m.len()).unwrap_or(0);

    let mut headers = common_headers();
    headers.push(ct_header("image/jpeg"));
    // Cache thumbnails aggressively — they rarely change
    headers.push(Header::from_bytes(b"Cache-Control", b"public, max-age=86400").unwrap());

    let resp = Response::new(
        StatusCode(200),
        headers,
        file,
        Some(file_len as usize),
        None,
    );

    let _ = request.respond(resp);
}
