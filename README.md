# Caste

A desktop media player with custom controls, animated backgrounds, equalizer,
resume playback, and native window behavior. Built with Tauri and React.

## Features

- **Custom title bar** — macOS-style traffic light controls, draggable region
- **Animated background** — canvas-rendered colorful blobs with frosted-glass overlay
- **Video equalizer** — brightness, contrast, saturation, hue, blur, grayscale, sepia
- **Audio equalizer** — 10-band peaking filter (31 Hz – 16 kHz) with presets
- **Resume playback** — persists last position (10-second granularity)
- **Transcoding** — automatic FFmpeg fallback for unsupported codecs
- **Auto-hide controls** — hover to reveal, hides after inactivity
- **Keyboard shortcuts** — space, arrows, escape, fullscreen
- **Drag and drop** — drag media files directly into the window
- **Folder scanning** — browse local media folders with thumbnail previews
- **Playback speed** — 0.25× to 4×
- **Subtitles** — embedded subtitle tracks + external SRT/VTT files

## Development

```bash
npm install
npm run tauri dev
```

## Building

```bash
npm run tauri build
```

## License

MIT. See [LICENSE](./LICENSE).

## Third-Party Licenses

This application bundles FFmpeg for media transcoding. See
[THIRD-PARTY-LICENSES](./THIRD-PARTY-LICENSES) for details.
