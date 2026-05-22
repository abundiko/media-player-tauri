# Feature Ideas

## Existing features

- Drag-and-drop file loading (Tauri native)
- File picker dialog (browse local media)
- HTTP streaming server with range-request support
- FFmpeg transcoding fallback (re-encode unsupported codecs to H.264 fMP4)
- Blob URL fallback (last resort)
- Play / Pause
- Skip forward / backward (10s)
- Progress bar with seek (debounced for transcode)
- Volume control (0–200%) + mute toggle
- Fullscreen toggle
- Speed control (0.2x, 0.5x, 1x, 1.5x, 2x, 3x) — `playbackRate` for direct streams, FFmpeg `setpts`/`atempo` for transcoded
- Fit / zoom (contain, cover, fill, none) — persisted in localStorage
- Subtitle support — built-in tracks via FFmpeg, external SRT/VTT files
- Keyboard shortcuts — Space (play/pause), Arrows (seek/volume), F (fullscreen)
- Auto-hide controls overlay on inactivity
- macOS traffic-light window-control inset
- Video dimension badge (e.g. 1920x1080)
- TRANSCODING badge for re-encoded files
- Theme toggle (light/dark)
- Error modal for unsupported formats
- Drag-overlay visual feedback

## Easy additions

### 1. Next / Previous file in folder
Scan siblings in the same directory with `std::fs::read_dir`. Add prev/next buttons in the top bar or controls. On `onEnded`, optionally auto-play the next file.

### 2. Remaining time display
Click the timestamp to toggle between `1:23 / 10:00` (elapsed) and `-8:37` (remaining).

### 3. Screenshot
Draw the current video frame onto a `<canvas>`, convert to PNG blob, save via Tauri dialog. Keyboard shortcut (e.g. `s`).

### 4. Mouse wheel volume
`onWheel` on the container adjusts volume up/down. Already wired through `usePlayerStore`.

### 5. Frame step
`.` advances one frame, `,` goes back one frame. Useful for video review. Need access to `video.duration`, count frames (or estimate at 30fps). Transcode case is trickier — requires re-transcode at new seek position ± one frame.

### 6. Stats for nerds
Overlay showing real-time data: resolution, codec name, frame rate, bitrate, dropped frames. Codec info requires an FFprobe call; the rest is available from the `<video>` element.

## Medium additions

### 7. Playlist / Queue
Store `files: string[]` and `currentIndex` in the store. Auto-play next on `onEnded`. "Open folder" button scans a directory for media files and populates the queue. Drag-to-reorder via a simple list component in a sidebar.

### 8. Resume playback
Save `{ path: lastPosition }` to localStorage on pause/close. On file load, show a "Resume from 12:34?" prompt.

### 9. A-B loop
Buttons or keyboard shortcuts to set point A and point B. The player loops between them. For transcode, this means re-seeking to position A each time B is reached.

### 10. Picture-in-Picture
`video.requestPictureInPicture()` — one browser API call. Trigger via a button in the controls or a keyboard shortcut.

### 11. Audio track switcher
Extend the existing `get_subtitle_tracks` Tauri command to also list audio tracks (`ffprobe -show_streams -select_streams a`). Switch via `-map 0:a:{idx}` in the transcode. For direct streams, browsers expose `video.audioTracks`.

### 12. Custom speed input
The `SpeedControl` already handles arbitrary values — just add an editable text field alongside the preset buttons to type a custom speed (e.g. `1.75`).

## Larger projects

### 13. Persistent media library
Scan directories, extract metadata via FFprobe (duration, codec, resolution, chapters), store in a local DB (e.g. SQLite via Tauri). Build a searchable grid/list view as the home screen instead of the current DropZone.

### 14. Keyboard shortcut reference
Press `?` to open a modal showing all available keyboard shortcuts.

### 15. CLI argument
Accept a file path as a command-line argument so the player launches directly into playback: `media-player /path/to/video.mp4`.
