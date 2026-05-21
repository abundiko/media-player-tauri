# Media Player Todo

## Standalone Deployment
- [ ] Implement Tauri Sidecar for FFmpeg.
  - Download pre-compiled `ffmpeg` and `ffprobe` binaries for Windows, macOS, and Linux.
  - Place them in `src-tauri/bin/`.
  - Update `tauri.conf.json` to bundle them using the `externalBin` array.
  - Update `media_server.rs` and `lib.rs` to use `tauri::api::process::Command::new_sidecar` instead of `std::process::Command::new` so the app doesn't require a system-installed FFmpeg CLI.
