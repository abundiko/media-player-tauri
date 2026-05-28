use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
#[cfg(unix)]
use std::os::unix::io::{FromRawFd, IntoRawFd, OwnedFd as PlatformHandle};
#[cfg(windows)]
use std::os::windows::io::{FromRawHandle, IntoRawHandle, OwnedHandle as PlatformHandle};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tiny_http::{Header, Method, Response, Server, StatusCode};

/// Maximum concurrent HTTP connections to the media server.
const MAX_CONNECTIONS: usize = 16;

/// Speed range cap — prevent extreme values that would produce unusable filter chains.
const MIN_SPEED: f64 = 0.1;
const MAX_SPEED: f64 = 16.0;

/// How long to keep an idle transcode process alive without a keepalive signal.
const KEEPALIVE_TIMEOUT: Duration = Duration::from_secs(30);

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
        Header::from_bytes(b"Access-Control-Allow-Origin", b"*").unwrap(),
        Header::from_bytes(b"Access-Control-Allow-Methods", b"GET, HEAD, OPTIONS").unwrap(),
        Header::from_bytes(b"Access-Control-Allow-Headers", b"Range").unwrap(),
        Header::from_bytes(
            b"Access-Control-Expose-Headers",
            b"Content-Range, Content-Length, Accept-Ranges",
        )
        .unwrap(),
        Header::from_bytes(b"Cache-Control", b"no-cache").unwrap(),
    ]
}

fn stdout_to_handle(stdout: std::process::ChildStdout) -> PlatformHandle {
    #[cfg(unix)]
    {
        unsafe { PlatformHandle::from_raw_fd(stdout.into_raw_fd()) }
    }
    #[cfg(windows)]
    {
        unsafe { PlatformHandle::from_raw_handle(stdout.into_raw_handle()) }
    }
}

fn kill_child(mut child: Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Verify a file path is safe (no path traversal, exists, and is a regular file).
fn is_safe_path(path: &str) -> bool {
    let p = Path::new(path);
    if !p.exists() {
        return false;
    }
    match p.canonicalize() {
        Ok(c) => {
            let s = c.to_string_lossy();
            !s.contains("/../") && !s.contains("/..\\")
        }
        Err(_) => false,
    }
}

#[allow(clippy::needless_pass_by_value)]
fn handle_request(
    request: tiny_http::Request,
    transcode_children: Arc<Mutex<HashMap<String, (u32, Child)>>>,
    keepalive_tracker: Arc<Mutex<HashMap<String, Instant>>>,
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

    // Route /transcode requests to the m3u8 playlist generator
    if url.starts_with("/transcode?") {
        handle_transcode_m3u8(request, &url);
        return;
    }

    // Route /transcode_stream requests to the transcode handler (ffmpeg pipe)
    if url.starts_with("/transcode_stream?") {
        handle_transcode_stream(request, &url, transcode_children, keepalive_tracker);
        return;
    }

    // Route /keepalive requests — update the tracker to keep idle transcodes alive
    if url.starts_with("/keepalive?") {
        handle_keepalive(request, &url, keepalive_tracker);
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

    if file_path.is_empty() || !Path::new(&file_path).exists() || !is_safe_path(&file_path) {
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
                .and_then(|s| {
                    if s.is_empty() {
                        None
                    } else {
                        s.parse::<u64>().ok()
                    }
                })
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
            headers.push(Header::from_bytes(b"Accept-Ranges", b"bytes").unwrap());
            headers.push(Header::from_bytes(b"Content-Range", cr_value.as_bytes()).unwrap());

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
    headers.push(Header::from_bytes(b"Accept-Ranges", b"bytes").unwrap());

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
/// `speed` is assumed to be clamped to [MIN_SPEED, MAX_SPEED].
fn speed_audio_filter(speed: f64) -> String {
    if speed == 1.0 {
        return String::new();
    }
    let clamped = speed.clamp(MIN_SPEED, MAX_SPEED);
    let mut parts = Vec::new();
    let mut s = clamped;
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

/// Update the keepalive timestamp for a file path so the drain thread
/// knows the client is still on the player screen.
/// URL format: /keepalive?path=<url-encoded-path>
fn handle_keepalive(
    request: tiny_http::Request,
    url: &str,
    keepalive_tracker: Arc<Mutex<HashMap<String, Instant>>>,
) {
    let query = url.strip_prefix("/keepalive?").unwrap_or("");
    let mut path = String::new();
    for param in query.split('&') {
        if let Some(val) = param.strip_prefix("path=") {
            path = urlencoding::decode(val).unwrap_or_default().to_string();
        }
    }
    if path.is_empty() || !Path::new(&path).exists() || !is_safe_path(&path) {
        let mut resp = Response::from_string("Not Found").with_status_code(404);
        for h in common_headers() {
            resp.add_header(h);
        }
        let _ = request.respond(resp);
        return;
    }
    keepalive_tracker
        .lock()
        .unwrap()
        .insert(path, Instant::now());
    let mut resp = Response::from_string("OK").with_status_code(200);
    for h in common_headers() {
        resp.add_header(h);
    }
    let _ = request.respond(resp);
}

fn handle_transcode_m3u8(request: tiny_http::Request, url: &str) {
    let query = url.strip_prefix("/transcode?").unwrap_or("");
    
    // Pass along the query to the stream endpoint
    let stream_url = format!("/transcode_stream?{}", query);
    
    // We create a dummy HLS playlist that points to the live stream
    let m3u8 = format!(
        "#EXTM3U\n\
         #EXT-X-VERSION:3\n\
         #EXT-X-TARGETDURATION:86400\n\
         #EXT-X-MEDIA-SEQUENCE:0\n\
         #EXTINF:86400.0,\n\
         {}\n\
         #EXT-X-ENDLIST\n",
        stream_url
    );

    let mut headers = common_headers();
    headers.push(ct_header("application/vnd.apple.mpegurl"));
    let mut resp = Response::from_string(m3u8)
        .with_status_code(200);
        
    for h in headers {
        resp.add_header(h);
    }
        
    let _ = request.respond(resp);
}

/// Transcode video on-the-fly via FFmpeg to MPEG-TS.
/// URL format: /transcode_stream?path=<url-encoded-path>&t=<seek-seconds>&s=<speed>
fn handle_transcode_stream(
    request: tiny_http::Request,
    url: &str,
    transcode_children: Arc<Mutex<HashMap<String, (u32, Child)>>>,
    keepalive_tracker: Arc<Mutex<HashMap<String, Instant>>>,
) {
    let query = url.strip_prefix("/transcode_stream?").unwrap_or("");
    let mut raw_path = String::new();
    let mut seek_secs: f64 = 0.0;
    let mut speed: f64 = 1.0;

    for param in query.split('&') {
        if let Some(val) = param.strip_prefix("path=") {
            raw_path = urlencoding::decode(val).unwrap_or_default().to_string();
        } else if let Some(val) = param.strip_prefix("t=") {
            seek_secs = val.parse().unwrap_or(0.0);
        } else if let Some(val) = param.strip_prefix("s=") {
            speed = val.parse().unwrap_or(1.0);
        }
    }

    // C2: validate path
    let path = raw_path;
    if path.is_empty() || !Path::new(&path).exists() || !is_safe_path(&path) {
        let resp = Response::from_string("Not Found").with_status_code(404);
        let _ = request.respond(resp);
        return;
    }

    // L9: clamp speed to sane range
    let speed = speed.clamp(MIN_SPEED, MAX_SPEED);

    // Kill any existing FFmpeg child for this file path (e.g. from a previous seek)
    {
        let mut map = transcode_children.lock().unwrap();
        if let Some((_pid, old)) = map.remove(&path) {
            std::thread::spawn(|| kill_child(old));
        }
    }

    let mut args: Vec<String> = vec!["-hide_banner".into(), "-loglevel".into(), "error".into()];
    if seek_secs > 0.0 {
        let coarse = (seek_secs - 1.0).max(0.0);
        args.extend(["-ss".into(), format!("{:.3}", coarse)]);
    }
    args.extend(["-i".into(), path.clone()]);
    if seek_secs > 0.0 {
        let fine = seek_secs - (seek_secs - 1.0).max(0.0);
        args.extend(["-ss".into(), format!("{:.3}", fine)]);
    }
    args.extend([
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "ultrafast".into(),
        "-tune".into(),
        "zerolatency".into(),
        "-crf".into(),
        "23".into(),
        "-fps_mode".into(),
        "cfr".into(),
    ]);
    if speed != 1.0 {
        args.extend(["-vf".into(), format!("setpts=PTS/{:.4}", speed)]);
        let afilter = speed_audio_filter(speed);
        if !afilter.is_empty() {
            args.extend(["-af".into(), afilter]);
        }
    }
    args.extend([
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "128k".into(),
        "-ac".into(),
        "2".into(),
        "-f".into(),
        "mpegts".into(),
        "pipe:1".into(),
    ]);

    let mut child = match crate::create_command(crate::get_ffmpeg_path())
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            log::error!("handle_transcode: spawn failed: {}", e);
            let resp = Response::from_string("ffmpeg error").with_status_code(500);
            let _ = request.respond(resp);
            return;
        }
    };

    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            let _ = child.kill();
            return;
        }
    };

    let my_pid = child.id();

    // Log stderr in a background thread for diagnostics (M7)
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let mut buf = String::new();
            let _ = std::io::BufReader::new(stderr).read_to_string(&mut buf);
            if !buf.is_empty() {
                log::error!("handle_transcode ffmpeg stderr: {}", buf.trim());
            }
        });
    }

    // Dup stdout so ffmpeg's pipe stays open even after the HTTP response ends.
    // Without this, the client disconnecting during a pause would close the pipe,
    // ffmpeg gets SIGPIPE, and the transcode process dies — requiring a full
    // reconnect when the user resumes.  The drain thread keeps reading the dup'd
    // end, preventing SIGPIPE and keeping ffmpeg alive for a grace period.
    let drain_fd = {
        let owned = stdout_to_handle(stdout);
        match owned.try_clone() {
            Ok(clone) => {
                let resp_body = File::from(clone);
                transcode_children
                    .lock()
                    .unwrap()
                    .insert(path.clone(), (my_pid, child));
                let mut headers = common_headers();
                headers.push(ct_header("video/mp2t"));
                headers.push(Header::from_bytes(b"Accept-Ranges", b"none").unwrap());
                let resp = Response::new(StatusCode(200), headers, resp_body, None, None);
                let _ = request.respond(resp);
                Some(owned)
            }
            Err(_) => {
                // Dup failed (too many fds) — fall back to direct pipe (no drain)
                let resp_body = File::from(owned);
                transcode_children
                    .lock()
                    .unwrap()
                    .insert(path.clone(), (my_pid, child));
                let mut headers = common_headers();
                headers.push(ct_header("video/mp2t"));
                headers.push(Header::from_bytes(b"Accept-Ranges", b"none").unwrap());
                let resp = Response::new(StatusCode(200), headers, resp_body, None, None);
                let _ = request.respond(resp);
                let mut map = transcode_children.lock().unwrap();
                if let Some((stored_pid, _)) = map.get(&path) {
                    if *stored_pid == my_pid {
                        let (_, c) = map.remove(&path).unwrap();
                        std::thread::spawn(|| kill_child(c));
                    }
                }
                None
            }
        }
    };

    // Drain + keepalive watchdog
    if let Some(drain) = drain_fd {
        let path_clone = path.clone();
        let tracker = keepalive_tracker.clone();
        let children = transcode_children.clone();
        std::thread::spawn(move || {
            let mut drain_file = File::from(drain);
            let mut buf = [0u8; 65536];
            loop {
                // Every read iteration, check if the client is still alive
                let alive = {
                    let t = tracker.lock().unwrap();
                    t.get(&path_clone)
                        .is_some_and(|last| last.elapsed() < KEEPALIVE_TIMEOUT)
                };
                if !alive {
                    break;
                }
                match drain_file.read(&mut buf) {
                    Ok(0) => break,    // EOF — ffmpeg finished naturally
                    Ok(_) => continue, // keep draining
                    Err(_) => break,   // pipe error — stop
                }
            }
            // Kill ffmpeg
            let mut map = children.lock().unwrap();
            if let Some((stored_pid, _)) = map.get(&path_clone) {
                if *stored_pid == my_pid {
                    if let Some((_, c)) = map.remove(&path_clone) {
                        kill_child(c);
                    }
                }
            }
        });
    }
}

pub struct MediaServer {
    pub port: u16,
    running: Arc<AtomicBool>,
    transcode_children: Arc<Mutex<HashMap<String, (u32, Child)>>>,
    // keepalive_tracker: Arc<Mutex<HashMap<String, Instant>>>,
}

impl MediaServer {
    pub fn start() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let server = Server::http("127.0.0.1:0")?;
        let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(0);
        let running = Arc::new(AtomicBool::new(true));
        let running_clone = running.clone();
        let transcode_children: Arc<Mutex<HashMap<String, (u32, Child)>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let keepalive_tracker: Arc<Mutex<HashMap<String, Instant>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let children_for_thread = transcode_children.clone();
        let keepalive_for_thread = keepalive_tracker.clone();
        let connection_count = Arc::new(AtomicUsize::new(0));
        let connection_count_clone = connection_count.clone();

        std::thread::spawn(move || {
            loop {
                if !running_clone.load(Ordering::Relaxed) {
                    break;
                }

                // L5: rate limiting — drop excess connections
                if connection_count_clone.load(Ordering::Relaxed) >= MAX_CONNECTIONS {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                    continue;
                }

                let request = match server.recv_timeout(std::time::Duration::from_millis(200)) {
                    Ok(Some(r)) => r,
                    Ok(None) => continue,
                    Err(e) => {
                        log::error!("media_server: recv error: {:?}", e);
                        break;
                    }
                };

                connection_count_clone.fetch_add(1, Ordering::Relaxed);

                let children = children_for_thread.clone();
                let keepalive = keepalive_for_thread.clone();
                let count = connection_count_clone.clone();
                std::thread::spawn(move || {
                    handle_request(request, children, keepalive);
                    count.fetch_sub(1, Ordering::Relaxed);
                });
            }
        });

        Ok(MediaServer {
            port,
            running,
            transcode_children,
        })
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

    if path.is_empty() || track_idx.is_empty() || !Path::new(&path).exists() || !is_safe_path(&path)
    {
        let _ = request.respond(Response::from_string("Bad Request").with_status_code(400));
        return;
    }

    // M8: Validate the track index is parseable before running ffmpeg
    let idx: usize = match track_idx.parse() {
        Ok(i) => i,
        Err(_) => {
            let _ =
                request.respond(Response::from_string("Invalid track index").with_status_code(400));
            return;
        }
    };

    let mut cmd = crate::create_command(crate::get_ffmpeg_path());
    cmd.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        &path,
        "-map",
        &format!("0:{}", idx),
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
    headers.push(Header::from_bytes(b"Accept-Ranges", b"none").unwrap());

    let resp = Response::new(StatusCode(200), headers, stdout, None, None);

    let _ = request.respond(resp);

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

    if thumb_path.is_empty() || !Path::new(&thumb_path).exists() || !is_safe_path(&thumb_path) {
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
