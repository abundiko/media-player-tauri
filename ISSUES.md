# Caste Media Player — Issues & Flaws

> Generated from static analysis of `caste` — a Tauri v2 + React 19 media player.
> Severity: 🔴 Critical | 🟠 High | 🟡 Medium | 🔵 Low

---

## 🔴 Critical

### C1. Embedded HTTP server bypasses Tauri security model

**File:** `src-tauri/src/media_server.rs:1-515`
**Root cause:** A second HTTP server (`tiny_http`) runs on a random localhost port beside Tauri's own IPC. The server:
- Has `Access-Control-Allow-Origin: *` CORS headers 
- Serves arbitrary files via unvalidated path query parameters
- Has no authentication, no rate limiting, no CSP enforcement

**Risk:** Any website visited in the user's browser can make requests to `http://127.0.0.1:<random-port>/file?path=/etc/passwd`. The port is random but discoverable (scan localhost ports, or leak it from the frontend).

**Fix:** Replace with Tauri v2's custom protocol (`asset://` or a custom protocol) which is sandboxed and not accessible from external origins. Alternatively, serve streaming content through Tauri's IPC using channels (`Channel<T>`) instead of a separate HTTP server.

---

### C2. Path traversal in media file endpoints

**File:** `src-tauri/src/media_server.rs:91-98`, `476-484`
**Root cause:** The `/file`, `/thumb`, `/subtitle`, and `/transcode` endpoints take a `path` query parameter and pass it directly to `Path::new(&file_path)` with no path traversal validation. Only the existence check `Path::new(&file_path).exists()` is done.

```rust
// line 91-93 — No path normalization or containment check
let file_path = decoded
    .strip_prefix("/file?path=")
    .or_else(|| decoded.strip_prefix("/"))
    .map(|s| s.to_string())
    .unwrap_or_default();
```

**Risk:** An attacker that discovers the media server port can read any file on disk — e.g., `GET /file?path=../../etc/passwd`.

**Fix:** Canonicalize the path with `std::fs::canonicalize()` and verify it is within an allowed root directory. Or, better, don't expose raw file system paths at all (see C1).

---

## 🟠 High

### H1. Missing FFmpeg sidecar binaries for macOS

**File:** `src-tauri/bin/`
**Current binaries:**
- `caste-ffmpeg-x86_64-pc-windows-gnu.exe` ✅ Windows
- `caste-ffmpeg-x86_64-unknown-linux-gnu` ✅ Linux
- `caste-ffprobe-x86_64-pc-windows-gnu.exe` ✅ Windows
- `caste-ffprobe-x86_64-unknown-linux-gnu` ✅ Linux
- **macOS (aarch64 / x86_64):** ❌ Missing

**Root cause:** The `tauri.conf.json` sets `"targets": "all"` (producing macOS `.dmg` bundles) and `externalBin` ships both binaries, but no macOS binaries are bundled. On macOS, the app silently falls back to system `ffmpeg`/`ffprobe` via `get_ffmpeg_path()` → `"ffmpeg"`.

**Risk:** Users on macOS without a system FFmpeg installation will have broken transcoding, thumbnails, metadata extraction, and subtitle support.

**Fix:** Ship macOS sidecar binaries:
```bash
# Build cross-platform FFmpeg binaries or download from a trusted source
# Required targets:
# - caste-ffmpeg-x86_64-apple-darwin
# - caste-ffmpeg-aarch64-apple-darwin
# - caste-ffprobe-x86_64-apple-darwin
# - caste-ffprobe-aarch64-apple-darwin
```

---

### H2. Blocking ffprobe calls on the main thread

**File:** `src-tauri/src/lib.rs:64-78` (`probe_duration`), `src-tauri/src/lib.rs:100-141` (`get_subtitle_tracks`)
**Root cause:** Both `probe_duration` and `get_subtitle_tracks` are synchronous Tauri commands that run `std::process::Command::new(...).output()` — a blocking call — on the main thread.

```rust
// line 64 — sync command, blocks main thread on ffprobe
#[tauri::command]
fn probe_duration(path: String) -> Result<f64, String> {
    let output = std::process::Command::new(get_ffprobe_path())
        .args([...])
        .output()  // BLOCKS HERE
        .map_err(|e| format!("ffprobe failed: {}", e))?;
```

**Risk:** If ffprobe hangs (corrupted file, network filesystem stall), the entire Tauri UI freezes until the process completes. The app becomes completely unresponsive.

**Fix:** Use `tauri::async_runtime::spawn_blocking()` like `get_video_metadata` and `scan_video_folder` already do:
```rust
#[tauri::command]
async fn probe_duration(path: String) -> Result<f64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let output = std::process::Command::new(get_ffprobe_path())
            .args([...])
            .output()?;
        // ...
    }).await.map_err(|e| ...)?
}
```

Also add a process timeout — ffprobe should never take more than a few seconds:
```rust
use std::time::Duration;
child.wait_timeout(Duration::from_secs(10))?;
if !child.status()... { child.kill()?; }
```

---

### H3. No FFmpeg process timeout — zombie processes on disconnect

**File:** `src-tauri/src/media_server.rs:219-338` (`handle_transcode`)
**Root cause:** When the client disconnects from a transcode stream, the response stream ends and the cleanup code spawns a thread to kill the child process (lines 328-337). However:
1. There is **no timeout** for transcoding — if FFmpeg hangs on a corrupted file, it runs forever.
2. The PID-based cleanup has a race condition (PIDs can wrap around on long-running systems).
3. Subtitle processes (`handle_subtitle`, line 472) always call `kill_child()`, which is correct, but transcoding cleanup depends on client disconnect detection.

**Fix:** 
```rust
// Add a watchdog thread that kills FFmpeg after N minutes
let child_pid = child.id();
let children_clone = transcode_children.clone();
std::thread::spawn(move || {
    std::thread::sleep(Duration::from_secs(300)); // 5 min timeout
    let mut map = children_clone.lock().unwrap();
    if let Some((pid, _)) = map.get(&path) {
        if *pid == child_pid {
            if let Some((_, child)) = map.remove(&path) {
                kill_child(child);
            }
        }
    }
});
```

---

### H4. Content Security Policy completely disabled

**File:** `src-tauri/tauri.conf.json:27`
```json
"security": {
    "csp": null
}
```

**Root cause:** CSP is set to `null`, disabling all web security policies. Combined with `dangerouslySetInnerHTML` for subtitle rendering (see `video-player.tsx:917`), any XSS vector in user-supplied content (subtitle files, filenames, URLs) is trivially exploitable.

**Risk:** A malicious SRT/VTT subtitle file containing `<script>` tags would execute arbitrary JavaScript in the app's context, with full access to Tauri APIs via `window.__TAURI__`.

**Fix:** Use a restrictive CSP that allows only needed origins:
```json
"csp": "default-src 'self'; media-src 'self' http://127.0.0.1:*; img-src 'self' http://127.0.0.1:* data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:;"
```
And sanitize subtitle content with DOMPurify before using `dangerouslySetInnerHTML`.

---

### H5. `read_file_bytes` exposes arbitrary file reads to frontend

**File:** `src-tauri/src/lib.rs:51-56`
```rust
#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    if !Path::new(&path).exists() {
        return Err(format!("File not found: {}", path));
    }
    std::fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))
}
```

**Root cause:** This command reads any file on disk with no path restrictions. Any JS code running in the webview (including from XSS) can read arbitrary files.

**Fix:** Restrict reads to allowed directories (media files, subtitle files) or the app's data directory:
```rust
fn is_allowed(path: &Path) -> bool {
    let canonical = path.canonicalize().ok();
    canonical.as_ref().map(|p| p.starts_with("/home") || p.starts_with("/media")).unwrap_or(false)
}
```

---

## 🟡 Medium

### M1. Sidecar binaries bypass Tauri's sidecar API

**File:** `src-tauri/src/lib.rs:15-37`
**Root cause:** Instead of using `tauri_plugin_shell`'s `app.shell().sidecar("caste-ffmpeg")` — which is the standard Tauri v2 sidecar API — the code manually resolves the sidecar path using `std::env::current_exe()` and path manipulation.

```rust
fn get_ffmpeg_path() -> String {
    if let Ok(mut exe_path) = std::env::current_exe() {
        exe_path.pop();
        let bin_name = if cfg!(target_os = "windows") { "caste-ffmpeg.exe" } else { "caste-ffmpeg" };
        let sidecar = exe_path.join(bin_name);
        if sidecar.exists() { return sidecar.to_string_lossy().to_string(); }
    }
    "ffmpeg".to_string()
}
```

**Problems:**
1. Bypasses Tauri's sidecar resource resolution (which handles `.asar` bundles, macOS `.app` bundles, etc.)
2. Unlikely to work correctly in production macOS `.app` bundles (binary is inside `Caste.app/Contents/MacOS/`, but sidecar is at `Caste.app/Contents/MacOS/bin/caste-ffmpeg`)
3. No mobile support — `externalBin` is desktop-only, and Tauri's shell plugin handles this properly
4. The `tauri.conf.json` has `externalBin` configured but the code doesn't use it

**Fix:** Install `tauri-plugin-shell` and use its sidecar API:
```rust
// Cargo.toml: tauri-plugin-shell = "2"
// capabilities: "shell:allow-execute", "shell:allow-open"
// Frontend: invoke('plugin:shell|execute', ...) or use Rust API
let sidecar = app.shell().sidecar("caste-ffmpeg")?;
let output = sidecar.args([...]).output()?;
```

---

### M2. Window label missing in `tauri.conf.json`

**File:** `src-tauri/tauri.conf.json:13-24`
**Current:**
```json
"windows": [{
    "title": "Caste",
    "width": 1024,
    ...
}]
```

**Fix:** Add `"label": "main"` — Tauri v2 requires window labels for capabilities and window management. The capabilities file references `"windows": ["main"]`, but the window config doesn't declare it:
```json
"windows": [{
    "label": "main",
    "title": "Caste",
    ...
}]
```

---

### M3. File association mimeType has invalid trailing semicolons

**File:** `src-tauri/tauri.conf.json:55`
```json
"mimeType": "video/mp4;video/x-matroska;video/x-msvideo;video/quicktime;..."
```

**Root cause:** MIME type lists should be comma-separated, not semicolon-separated. The string also ends with a trailing `;`.

**Risk:** File associations may not register correctly on Windows, preventing "Open with Caste" from working.

**Fix:** Use proper comma separation (or a single MIME type since many platforms only support one):
```json
"mimeType": "video/mp4"
```

---

### M4. `tiny_http` server not integrated with Tauri lifecycle

**File:** `src-tauri/src/media_server.rs:347-379`
**Root cause:** The media server runs in a raw OS thread, not integrated with Tauri's async runtime. It uses `recv_timeout` polling (200ms) which is inefficient and subject to thundering-herd issues under load.

**Fix:** Consider using Tauri's custom protocol API (available in Tauri v2) or re-architecting to serve media through Tauri IPC channels instead of a separate HTTP server. If the HTTP server must stay, integrate it with Tauri's async runtime using `tokio::net::TcpListener`.

---

### M5. No macOS FFmpeg binaries despite `"targets": "all"`

**Severity:** 🟡 Medium (blocker for macOS releases)

**File:** `src-tauri/bin/`
**Detail:** Four binaries exist (Linux/Windows × ffmpeg/ffprobe), but `tauri.conf.json` specifies `"targets": "all"` which includes macOS `.dmg` bundles. Without macOS sidecar binaries, macOS users get broken transcoding unless they have system FFmpeg installed.

**Fix:** Add binaries for:
- `caste-ffmpeg-aarch64-apple-darwin`
- `caste-ffmpeg-x86_64-apple-darwin`
- `caste-ffprobe-aarch64-apple-darwin`
- `caste-ffprobe-x86_64-apple-darwin`

---

### M6. Sidecar binary naming doesn't follow Tauri v2 conventions

**File:** `src-tauri/tauri.conf.json:47-50`
```json
"externalBin": [
    "bin/caste-ffmpeg",
    "bin/caste-ffprobe"
]
```

**Root cause:** Tauri v2 expects sidecar binaries to be named with the target triple suffix (e.g., `caste-ffmpeg-x86_64-unknown-linux-gnu`), which they are. But the manual path resolution in `get_ffmpeg_path()` (lines 15-37) only checks `caste-ffmpeg` without the triple suffix, so it won't find the actual bundled binaries this way.

**Fix:** Either use Tauri's sidecar API (see M1) which handles the triple-suffixed names automatically, or update `get_ffmpeg_path()` to look for triple-suffixed names.

---

### M7. FFmpeg stderr silenced — impossible to debug failures

**File:** `src-tauri/src/lib.rs:313` (`get_video_thumbnail`), `media_server.rs:294` (`handle_transcode`)
```rust
.stderr(std::process::Stdio::null())
```

**Root cause:** FFmpeg's diagnostic output (stderr) is redirected to `/dev/null` in thumbnail generation and transcode streaming. When transcoding fails, there's zero diagnostic information available.

**Fix:** Log stderr instead of discarding it:
```rust
.stderr(std::process::Stdio::piped())
// Then read and log it in a background thread
```

---

### M8. Subtitle route maps raw stream index without type checking

**File:** `src-tauri/src/media_server.rs:423-424`
```rust
"-map", &format!("0:{}", track_idx),
```

**Root cause:** The `track_idx` comes from the frontend without validation that it references a subtitle stream. If the frontend sends `track=0` (which is typically a video stream), FFmpeg will output raw video data as WebVTT.

**Fix:** Read the stream type from ffprobe output first, or validate on the server side before running FFmpeg.

---

## 🔵 Low

### L1. Stale closure in `HomePage.tsx` folder scan handler

**File:** `src/HomePage.tsx:120-127`
```tsx
if (!foldersState[key]) {
    await scanFolder(key, selected, name);
}
markExplicitFolder(key);
const folder = foldersState[key] || useLocalMediaStore.getState().folders[key];
```

**Root cause:** `foldersState` is captured from the render cycle. After `await scanFolder()`, the zustand store is updated but the local `foldersState` is stale until React re-renders. The fallback `useLocalMediaStore.getState().folders[key]` works but is a non-reactive bypass.

---

### L2. Duplicate keyboard event interception between RootLayout and KeyboardHandler

**Files:** `src/RootLayout.tsx:141-162`, `src/components/player/keyboard-handler.tsx:19-67`
**Root cause:** `RootLayout` registers a capture-phase keydown listener that prevents default on Arrow keys, Space, Home, End, PageUp, PageDown. `KeyboardHandler` also handles these same keys. While functionally correct (double `preventDefault()` is harmless), the duplication makes the code confusing and violates separation of concerns.

---

### L3. Memory leak in thumbnail cache

**File:** `src/stores/local-media.ts:108`
```ts
thumbnailCache: Record<string, string | null>
```

**Root cause:** The thumbnail cache (`<video_path> → URL`) grows unbounded. As users browse more folders, cached entries are never evicted. On large media libraries (10,000+ files), this could consume significant memory.

**Fix:** Implement LRU eviction or limit cache size (e.g., 500 entries).

---

### L4. Symlinks silently ignored in folder scanner

**File:** `src-tauri/src/lib.rs:224-226`
```rust
if path.is_symlink() {
    continue;
}
```

**Root cause:** All symbolic links are skipped, even if they point to valid media directories or files. This prevents users from adding symlinked media folders.

**Fix:** Follow symlinks but use a visited-set to detect cycles:
```rust
let real = std::fs::canonicalize(&path).ok();
if visited.contains(&real) { continue; }
visited.insert(real);
```

---

### L5. No rate limiting on media server connections

**File:** `src-tauri/src/media_server.rs:372-374`
```rust
std::thread::spawn(|| {
    handle_request(request, children);
});
```

**Root cause:** Every HTTP request spawns a new OS thread with no connection limit. An attacker (or buggy frontend) could open unlimited connections, causing resource exhaustion.

**Fix:** Use a thread pool or semaphore to limit concurrent connections.

---

### L6. Build number not managed

**File:** `src-tauri/tauri.conf.json:4`
```json
"version": "0.1.0"
```

**Root cause:** The version is hardcoded and not tied to CI tags or automated versioning. There's no build number scheme, making it impossible to distinguish between builds.

---

### L7. `animated-background` canvas animation may impact playback performance

**File:** `src/components/player/animated-background.tsx`
**Root cause:** The canvas animation with 7 blobs uses `requestAnimationFrame` continuously during video playback. On integrated GPUs or lower-end systems, this competes with video decoding for GPU resources.

**Fix:** Suspend the animation when video is playing (or reduce frame rate):
```ts
if (playing) { ctx.globalAlpha = 0.15; /* reduce detail */ }
```

---

### L8. Equalizer state saved to localStorage on every slider change

**File:** `src/stores/equalizer.ts:80-87`
```ts
setVideoFilter: (key, value) => {
    set((s) => {
        const video = { ...s.video, [key]: value }
        const next = { ...s, video, videoPreset: 'custom' as string }
        save(next)  // <-- called on every mouse move
        return next
    })
},
```

**Root cause:** Every slider movement during audio/video equalizer adjustment triggers `JSON.stringify` + `localStorage.setItem`. At 60fps slider interaction, this causes jank and wears out the storage device.

**Fix:** Debounce the save:
```ts
const debouncedSave = useRef(debounce(save, 200)).current;
```

---

### L9. `speed_audio_filter` can produce extremely long filter strings

**File:** `src-tauri/src/media_server.rs:199-215`
**Root cause:** For extreme speeds (e.g., 1000x), chaining multiple atempo filters creates a filter string like `atempo=2.0,atempo=2.0,...` (many repetitions). This could hit `ARGS_MAX` on some platforms.

**Fix:** Add a speed cap or optimize with fewer atempo chains.

---

### L10. Route `/player/youtube/:videoId` routes to YouTube no-cookie embed

**File:** `src/components/player/youtube-player.tsx`
**Detail:** Uses `youtube-nocookie.com` which is good for privacy, but the route and embed logic is completely separate from the main `VideoPlayer` component. There's no shared state, keyboard shortcuts, or subtitle support for YouTube content.

---

## FFmpeg-Specific Issues

### F1. Thumbnail generation seeks without input analysis

**File:** `src-tauri/src/lib.rs:301-308`
```rust
for seek in ["5", "2", "0"] {
    let result = std::process::Command::new(&ffmpeg_path)
        .args(["-ss", seek, "-i", &path_clone, ...])
```

**Root cause:** The thumbnail tries seek positions at 5s, 2s, and 0s. For very short videos (<2s), all positions are valid but for long videos it always picks 5s. There's no analysis of video content to pick a representative frame.

**Fix:** Use `ffprobe` to detect scene changes and pick the most representative frame, or use a percentage-based seek (e.g., 10% into the video).

---

### F2. Transcode uses `libx264` with `ultrafast` preset — poor compression

**File:** `src-tauri/src/media_server.rs:271-273`
```rust
"-c:v", "libx264",
"-preset", "ultrafast",
"-tune", "zerolatency",
"-crf", "23",
```

**Root cause:** The `ultrafast` preset prioritizes encoding speed over file size, producing bitrates 3-5x higher than `medium` preset at the same CRF. For long videos, this can produce multi-GB transcoded streams.

**Fix:** Use `veryfast` or `faster` preset as a middle ground — the latency increase is minimal (~100ms) but compression improves significantly.

---

### F3. Missing FFmpeg output validation after transcoding

**File:** `src-tauri/src/media_server.rs:291-304`
**Root cause:** After spawning FFmpeg for transcoding, the code doesn't validate that FFmpeg actually started producing valid output. If FFmpeg fails silently (e.g., codec not supported), the client receives a truncated or empty MP4.

**Fix:** Read a few bytes from FFmpeg's stdout before responding to ensure the stream is valid:
```rust
// Read the first few bytes to validate (MP4 starts with ftyp box)
let mut buf = [0u8; 8];
stdout.read_exact(&mut buf)?;
if &buf[4..8] != b"ftyp" { return Err("invalid MP4 output".into()); }
// Then wrap stdout for streaming
```

---

### F4. Concurrent thumbnail generation limited but not queued per-file

**File:** `src-tauri/src/lib.rs:285`
```rust
let _permit = sem.0.acquire().await ...  // Semaphore(2)
```

**Root cause:** The semaphore limits concurrent FFmpeg thumbnail processes to 2. However, if the same video file is requested multiple times before the first thumbnail is cached, multiple FFmpeg processes will extract the same thumbnail.

**Fix:** Add a per-file in-progress cache (e.g., `Mutex<HashMap<String, oneshot::Sender<Result>>>`).

---

### F5. FFmpeg process handles not cleaned up on app crash

**File:** `src-tauri/src/media_server.rs:382-393`
**Root cause:** While the `Drop` impl kills all child processes on normal shutdown, an abnormal crash (panic, SIGKILL) will leave orphan FFmpeg processes running indefinitely.

**Fix:** On Linux, use `prctl(PR_SET_PDEATHSIG, SIGTERM)` to have the kernel kill children when the parent dies. On other platforms, consider a watchdog.

---

## Summary

| Severity | Count | Key Issues |
|----------|-------|------------|
| 🔴 Critical | 2 | External HTTP server bypasses Tauri security, Path traversal |
| 🟠 High | 5 | Missing macOS binaries, Blocking main thread, Zombie processes, CSP disabled, Arbitrary file reads |
| 🟡 Medium | 8 | Sidecar API bypass, Missing window label, Bad mimeType, Lifecycle integration, etc. |
| 🔵 Low | 10 | Stale closures, Memory leaks, Performance concerns, etc. |
| FFmpeg | 5 | Thumbnail strategy, Compression preset, Output validation, etc. |

**Top 3 fixes (highest impact):**
1. 🔴 Replace the `tiny_http` media server with Tauri's custom protocol or IPC channels
2. 🟠 Add CSP, sanitize subtitle rendering, and restrict `read_file_bytes`
3. 🟠 Make blocking commands async with timeouts, add macOS FFmpeg binaries
