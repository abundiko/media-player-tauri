# Media Player — Architecture & Tech Stack Plan

## Goal
Build a cross-platform media player as capable as VLC: play virtually all audio/video formats, support hardware decoding, subtitles, playlists, streaming, and a premium modern UI.

---

## Tech Stack (Recommended)

| Layer | Choice | Rationale |
|---|---|---|
| **Desktop Framework** | **Tauri 2** (Rust) | Small binary (~600KB), native performance, secure by design, cross-platform (Win/Mac/Linux/Android/iOS). Best Rust-native desktop framework. |
| **Frontend** | **Vite + React + TypeScript** | Fastest dev experience, huge ecosystem, matches your instinct. |
| **Styling** | **Tailwind CSS** | Utility-first, composable, hot-reload friendly. |
| **UI Components** | **shadcn/ui** (Radix-based) | Accessible, unstyled primitives, tailwind-native, copy-paste components. |
| **State Management** | **Zustand** | Minimal boilerplate, works great with React, tiny bundle. |
| **Media Engine** | **mpv via libmpv** | Best Rust/Tauri integration, same FFmpeg codec support as VLC. |

---

## Media Engine: mpv over VLC / raw FFmpeg

**mpv** uses **FFmpeg** internally for decoding — it supports the exact same codecs VLC does (H.264/5, AV1, VP9, AAC, FLAC, MP3, etc.) plus hardware decoding via `--hwdec=auto-safe`.

Why mpv wins here:

| Factor | mpv (libmpv) | VLC (libvlc) | Raw FFmpeg bindings |
|---|---|---|---|
| **Rust ecosystem** | Excellent — `tauri-plugin-libmpv` actively maintained | Mediocre — `vlc-rs` stale | Good but need to build player from scratch |
| **Tauri integration** | Dedicated plugin embeds video via libmpv | No first-class plugin | Manual work |
| **Size** | ~10MB (libmpv.so/dylib/dll) | ~80MB | ~100MB (ffmpeg) |
| **Embedding** | Direct window embedding via `wid` | Needs child window workaround | N/A |
| **Format support** | Identical to VLC (both use FFmpeg) | Identical | Full |

**Tauri plugins available:**
- `tauri-plugin-libmpv` — embeds mpv via libmpv C API, best for video display
- `tauri-plugin-mpv` — controls mpv via JSON IPC, lighter but less direct

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    Tauri 2 App                       │
│  ┌───────────────────────────────────────────────┐  │
│  │            React Frontend (Vite)              │  │
│  │  ┌──────┐ ┌──────────┐ ┌──────────────────┐  │  │
│  │  │Player│ │ Playlist │ │ Settings / Lib    │  │  │
│  │  │UI    │ │ Manager  │ │ Media Library     │  │  │
│  │  └──┬───┘ └──────────┘ └──────────────────┘  │  │
│  │     │    ┌──────────────────────────────┐     │  │
│  │     │    │  @tauri-apps/api (IPC calls) │     │  │
│  │     │    └──────────┬───────────────────┘     │  │
│  └─────┼───────────────┼─────────────────────────┘  │
│        │    IPC bridge │                            │
│  ┌─────┼───────────────┼─────────────────────────┐  │
│  │  ┌──┴───────────────┴───────────────────┐     │  │
│  │  │         Rust Backend (Tauri)         │     │  │
│  │  │  ┌────────────────────────────────┐  │     │  │
│  │  │  │  tauri-plugin-libmpv           │  │     │  │
│  │  │  │  (mpv video/audio playback)    │  │     │  │
│  │  │  └────────────┬───────────────────┘  │     │  │
│  │  │  ┌────────────┴───────────────────┐  │     │  │
│  │  │  │  Custom Commands:              │  │     │  │
│  │  │  │  - open_file / open_url        │  │     │  │
│  │  │  │  - play/pause/stop/seek       │  │     │  │
│  │  │  │  - volume/speed/subtitles     │  │     │  │
│  │  │  │  - playlist management        │  │     │  │
│  │  │  │  - metadata extraction        │  │     │  │
│  │  │  └───────────────────────────────┘  │     │  │
│  │  └─────────────────────────────────────┘     │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │         mpv (libmpv process/embedded)         │  │
│  │  ┌───────────┐ ┌──────────┐ ┌─────────────┐  │  │
│  │  │ Decoder   │ │ Hardware │ │ Output      │  │  │
│  │  │ (FFmpeg)  │ │ Decoding │ │ (Video+Audio│  │  │
│  │  │ All codecs│ │ (VAAPI/  │ │  Render)    │  │  │
│  │  │           │ │  NVDEC/) │ │             │  │  │
│  │  └───────────┘ └──────────┘ └─────────────┘  │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## Project Structure

```
media-player/
├── src-tauri/              # Rust backend (Tauri)
│   ├── src/
│   │   ├── main.rs         # Tauri app entry + plugin setup
│   │   ├── commands.rs     # IPC commands (play, pause, etc.)
│   │   ├── player.rs       # mpv wrapper / control
│   │   ├── playlist.rs     # Playlist management
│   │   ├── library.rs      # Media library / SQLite
│   │   └── metadata.rs     # Tag reading (via ffmpeg or lofty)
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                    # React frontend
│   ├── components/
│   │   ├── Player/         # Video canvas, controls overlay
│   │   ├── Playlist/       # Sidebar playlist
│   │   ├── Library/        # Media library browser
│   │   ├── Settings/       # Settings panels
│   │   └── ui/             # shadcn/ui primitives
│   ├── hooks/              # usePlayer, usePlaylist, etc.
│   ├── stores/             # Zustand stores
│   ├── lib/                # Tauri IPC wrappers
│   ├── App.tsx
│   └── main.tsx
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── vite.config.ts
```

---

## Key Features Roadmap

### Phase 1 — Core Player (MVP)
- File open, drag-and-drop, URL streaming
- Play/pause/stop/seek, volume control
- Video window with mpv embedding
- Audio-only mode with visualization
- Basic OSD (time, title)

### Phase 2 — Playback Features
- Playlist (m3u, m3u8, drag-reorder)
- Subtitle support (SRT, ASS, VTT, embedded)
- Audio track switching
- Speed control (0.25x–4x)
- A-B loop
- Screenshot capture
- Equalizer / audio filters

### Phase 3 — Media Library
- Filesystem scanner / watch folders
- SQLite-backed library (via `tauri-plugin-sql` or `drizzle`)
- Metadata extraction (title, artist, album, codec info)
- Search, filter, sort
- Cover art extraction

### Phase 4 — Advanced
- Hardware decoding (VAAPI, NVDEC, VideoToolbox)
- Chromecast / DLNA streaming
- Audio visualizations (spectrum, waveform)
- Keyboard shortcuts / global media keys
- Custom themes / accent colors
- Keyboard shortcuts config
- Equalizer presets

---

## Key Rust Crates

| Crate | Purpose |
|---|---|
| `tauri-plugin-libmpv` | Embed mpv video in Tauri window via libmpv |
| `mpv-rs` or `libmpv-rs` | Rust bindings to libmpv C API |
| `lofty` | Audio tag reading (ID3, FLAC, Vorbis) |
| `tauri-plugin-dialog` | Native file open dialogs |
| `tauri-plugin-fs` | Filesystem access |
| `tauri-plugin-sql` | SQLite for media library |
| `serde` / `serde_json` | JSON serialization for IPC |

---

## Why This Stack Is VLC-Class

1. **Same decoding engine** — mpv uses FFmpeg/libavcodec, the same library VLC uses. Every format VLC plays, mpv plays.
2. **Hardware acceleration** — mpv supports VAAPI (Linux), NVDEC/NVENC (NVIDIA), VideoToolbox (macOS), DXVA2/D3D11 (Windows).
3. **Superior UI** — React + Tailwind + shadcn lets you build a genuinely modern, custom UI that VLC's Qt-based one can't match.
4. **Tiny footprint** — Tauri apps start at ~600KB + libmpv (~10MB). VLC is ~80MB+.
5. **Cross-platform** — One codebase for Windows, macOS, Linux (and mobile if desired).
6. **Extensible** — Rust gives you native performance for CPU-intensive tasks; React gives you rapid UI iteration.

---

## Getting Started

```bash
# Create the Tauri project
npm create tauri-app@latest media-player -- --template react-ts
cd media-player

# Add dependencies
npm install zustand tailwindcss @tailwindcss/vite
npm install lucide-react # Icons
npx shadcn@latest init   # shadcn/ui

# Add mpv plugin
npm run tauri add libmpv

# Install system libmpv (Linux)
sudo apt install libmpv-dev
# (macOS) brew install mpv
```

Then implement:
1. Configure `tauri-plugin-libmpv` in `src-tauri/src/main.rs`
2. Set up transparent window in `tauri.conf.json` for mpv embedding
3. Build the React player UI with Tailwind + shadcn
4. Wire Tauri IPC commands for playback control
