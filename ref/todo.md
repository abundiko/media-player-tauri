# Media Player Todo

## Standalone Deployment

- [ ] Implement Tauri Sidecar for FFmpeg.
  - Download pre-compiled `ffmpeg` and `ffprobe` binaries for Windows, macOS, and Linux.
  - Place them in `src-tauri/bin/`.
  - Update `tauri.conf.json` to bundle them using the `externalBin` array.
  - Update `media_server.rs` and `lib.rs` to use `tauri::api::process::Command::new_sidecar` instead of `std::process::Command::new` so the app doesn't require a system-installed FFmpeg CLI.

# Standalone Deployment via Tauri Sidecars

To make this media player truly portable across Windows, macOS, and Linux, we need to package `ffmpeg` and `ffprobe` directly into the app bundle. This ensures users don't have to install any dependencies.

## User Review Required & Action Items

> [!IMPORTANT]
> Because bundling raw FFmpeg binaries can balloon your app size to over 150MB, you need to download specific "Essential" or compressed builds and place them in the correct folder with the correct naming convention before I can implement the Rust side of the changes.

Please follow these steps:

### 1. Download Binaries for Your Target OS

To keep the bundle small, I recommend downloading "essential" or stripped-down static builds rather than full builds.

- **Windows**: Download the `ffmpeg-master-latest-win64-gpl-shared` or `essentials` zip from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/). Extract `ffmpeg.exe` and `ffprobe.exe`.
- **macOS**: Download the static builds from [evermeet.cx](https://evermeet.cx/ffmpeg/) (they offer both Intel and Apple Silicon versions).
- **Linux**: Download the AMD64/ARM64 static builds from [johnvansickle.com](https://johnvansickle.com/ffmpeg/).

### 2. Rename and Place in `src-tauri/bin/`

Create a folder named `bin` inside `src-tauri`. You must rename the downloaded executables by appending the **Rust target triple** of the platform you are compiling for.

For example, if you are building for 64-bit Linux right now, your folder should look like this:

```
src-tauri/
  bin/
    ffmpeg-x86_64-unknown-linux-gnu
    ffprobe-x86_64-unknown-linux-gnu
```

_(If you are on an M1 Mac, it would be `-aarch64-apple-darwin`. If on Windows, `-x86_64-pc-windows-msvc.exe`)_

**Please let me know once you have created the `src-tauri/bin/` folder and placed the renamed binaries inside it. Once you do, I will execute the following plan:**

## Proposed Changes

### Configuration

#### [MODIFY] [tauri.conf.json](file:///home/abundiko/src/rust/media-player/src-tauri/tauri.conf.json)

- Add `"externalBin": ["bin/ffmpeg", "bin/ffprobe"]` to the `bundle` configuration. Tauri will automatically look in the `bin/` folder, find the binaries matching the current build target, and package them inside the final installer.

#### [MODIFY] [Cargo.toml](file:///home/abundiko/src/rust/media-player/src-tauri/Cargo.toml)

- Add `tauri-plugin-shell` dependency. Tauri v2 uses this plugin to securely execute bundled sidecars.

### Backend (Rust)

#### [MODIFY] [media_server.rs](file:///home/abundiko/src/rust/media-player/src-tauri/src/media_server.rs)

- Replace `std::process::Command::new("ffmpeg")` with `app_handle.shell().sidecar("ffmpeg")`.
- Pass the `AppHandle` down to the `MediaServer` to grant it access to the shell API.

#### [MODIFY] [lib.rs](file:///home/abundiko/src/rust/media-player/src-tauri/src/lib.rs)

- Update `probe_duration`, `get_subtitle_tracks`, and `get_video_thumbnail` to use `app_handle.shell().sidecar("ffprobe")` and `app_handle.shell().sidecar("ffmpeg")` instead of the system `std::process`.

## Verification Plan

Once the changes are made, I will compile the application using `cargo check`. You can then verify it by temporarily renaming/removing your system-installed `ffmpeg` from your PATH and running `bun tauri dev` to confirm the app correctly uses the bundled sidecar.
