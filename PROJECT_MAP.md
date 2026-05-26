# Caste Media Player - Project Map

## Frontend Architecture
- **Framework**: React with Vite
- **Routing**: `react-router-dom` (configured in `main.tsx`)
- **State Management**: `zustand` (stores located in `src/stores/`)
  - `player.ts`: Core player state (current file, playback state, etc.)
  - `local-media.ts`: File system scanning, cache, explicit folder tracking, history
  - `equalizer.ts`: Video filters and 10-band audio equalizer settings
  - `resume.ts`: Playback resume position storage
- **UI Components**: `src/components/`
  - `player/`: Core video player (`video-player.tsx`), controls, equalizer popover, animated background
  - `title-bar.tsx`: Custom macOS-style window title bar for Tauri
  - `folder-card.tsx`, `folder-media-modal.tsx`: File browsing UI components
- **Layouts/Pages**:
  - `HomePage.tsx`: Main screen showing history and explicit folders
  - `RootLayout.tsx`: Application container handling theme, spacebar block, etc.

## Backend Architecture (Tauri / Rust)
- **Framework**: Tauri v2
- **Core Files**: `src-tauri/src/`
  - `main.rs`: Entry point
  - `lib.rs`: Tauri commands (`get_stream_url`, `read_file_bytes`, `get_transcode_url`, `start_transcoding`, etc.)
  - `media_server.rs`: Tiny HTTP streaming server, FFmpeg child process spawning for on-the-fly transcoding
- **Media Engine**: FFmpeg
  - Bundled as external sidecar (`caste-ffmpeg`, `caste-ffprobe`)
  - Handles streaming, seeking, and unsupported format transcoding

## Key Mechanisms
- **Video Playback**: Directly streams supported formats via Tauri HTTP media server (`media_server.rs`). Unsupported formats are transcoded on the fly using FFmpeg to fragmented MP4.
- **Equalizer**: Implements Web Audio API's `BiquadFilterNode` for audio and CSS `filter` for video.
- **Resume Feature**: Saves position to localStorage every 15s; auto-seeks on next open.

## Identified Bugs & Solutions
1. **Back Button Bug**:
   - *Issue*: Clicking 'Back' in `title-bar.tsx` navigates home without closing the player state, breaking subsequent playback.
   - *Fix*: Call `usePlayerStore.getState().close()` before `navigate("/")`.
2. **Video Glitches/Stutters**:
   - *Issue*: FFmpeg transcoder uses `-preset ultrafast` but lacks tuning for zero latency, causing buffering/stutters.
   - *Fix*: Add `"-tune", "zerolatency"` to the FFmpeg args in `media_server.rs`.
3. **Open With Registration**:
   - *Issue*: App doesn't appear in "Open With" list on Linux.
   - *Fix*: Add the `mimeType` property to the `fileAssociations` block in `tauri.conf.json`.
