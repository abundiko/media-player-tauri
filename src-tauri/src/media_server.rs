use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
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

fn handle_request(request: tiny_http::Request) {
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
        handle_transcode(request, &url);
        return;
    }

    // Route /subtitle requests to the subtitle handler
    if url.starts_with("/subtitle?") {
        handle_subtitle(request, &url);
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

/// Transcode video on-the-fly via FFmpeg to H.264 fragmented MP4.
/// URL format: /transcode?path=<url-encoded-path>&t=<seek-seconds>
fn handle_transcode(request: tiny_http::Request, url: &str) {
    let query = url.strip_prefix("/transcode?").unwrap_or("");
    let mut path = String::new();
    let mut seek_secs: f64 = 0.0;

    for param in query.split('&') {
        if let Some(val) = param.strip_prefix("path=") {
            path = urlencoding::decode(val).unwrap_or_default().to_string();
        } else if let Some(val) = param.strip_prefix("t=") {
            seek_secs = val.parse().unwrap_or(0.0);
        }
    }

    if path.is_empty() || !Path::new(&path).exists() {
        let resp = Response::from_string("Not Found").with_status_code(404);
        let _ = request.respond(resp);
        return;
    }

    let mut args: Vec<String> = vec![
        "-hide_banner".into(), "-loglevel".into(), "error".into(),
    ];
    if seek_secs > 0.0 {
        args.extend(["-ss".into(), format!("{:.3}", seek_secs)]);
    }
    args.extend([
        "-i".into(), path,
        "-c:v".into(), "libx264".into(),
        "-preset".into(), "ultrafast".into(),
        "-crf".into(), "23".into(),
        "-c:a".into(), "aac".into(),
        "-b:a".into(), "128k".into(),
        "-f".into(), "mp4".into(),
        "-movflags".into(), "frag_keyframe+empty_moov+default_base_moof".into(),
        "pipe:1".into(),
    ]);

    let mut child = match std::process::Command::new("ffmpeg")
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
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

    let mut headers = common_headers();
    headers.push(ct_header("video/mp4"));

    let resp = Response::new(StatusCode(200), headers, stdout, None, None);
    let _ = request.respond(resp);

    // Clean up child process after response is sent
    let _ = child.kill();
    let _ = child.wait();
}

pub struct MediaServer {
    pub port: u16,
    running: Arc<AtomicBool>,
}

impl MediaServer {
    pub fn start() -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let server = Server::http("127.0.0.1:0")?;
        let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(0);
        let running = Arc::new(AtomicBool::new(true));
        let running_clone = running.clone();

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

                std::thread::spawn(|| {
                    handle_request(request);
                });
            }
        });

        Ok(MediaServer { port, running })
    }
}

impl Drop for MediaServer {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
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

    let mut cmd = std::process::Command::new("ffmpeg");
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

    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

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
            use std::io::Read;
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

    match child.wait() {
        Ok(status) => {
            if !status.success() {
                log::error!("handle_subtitle: ffmpeg exited with status {}", status);
            }
        }
        Err(e) => {
            log::error!("handle_subtitle: failed to wait for ffmpeg: {}", e);
        }
    }
}
