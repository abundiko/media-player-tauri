# Design System — macOS-style Desktop Media Player

## Philosophy
A native-feeling desktop media player that looks and behaves like a well-crafted macOS app. Chrome is minimal, content is king. Every pixel serves a purpose.

---

## macOS Visual Language

### Window
- **Unified titlebar + toolbar** — window controls (traffic lights) are part of the toolbar area, not a separate title bar. Tauri handles the native traffic light inset via `decorations: true` or we draw our own via `data-tauri-drag-region`.
- **Vibrancy / blur** — backgrounds use `backdrop-blur-*` and translucent surfaces (`bg-surface/80`) to mimic macOS's native frosted-glass materials.
- **No splashy colors** — pure grayscale palette. No accent color anywhere. Hierarchy comes from weight, spacing, and size, not hue.
- **Rounded corners** — `rounded-lg` (8px) for panels, `rounded-xl` (12px) for modals, `rounded-full` for badges/pills.

### Typography
- **Font** — `system-ui, -apple-system, sans-serif` (SF Pro on macOS, Segoe UI on Windows, system default on Linux).
- **Sizes** — `text-xs` (11px) for captions, `text-sm` (12px) for body/ labels, `text-base` (13px) for default content, `text-lg` (15px) for section titles.
- **Weights** — `font-medium` (500) for labels and titles, `font-normal` (400) for body. No bold (700) unless absolutely necessary.
- **Leading** — tight: `leading-tight` for titles, `leading-normal` for body.

### Spacing
- **4px grid** — all spacing is multiples of 4 (`gap-1` = 4px, `p-3` = 12px, etc.).
- **Generous padding** — macOS apps breathe. Panels get `p-4` (16px) minimum.
- **Section spacing** — `gap-6` (24px) between major sections.

---

## Component Patterns

### Buttons
- **Icon buttons** (toolbar) — `p-1.5 rounded-md hover:bg-surface-hover`, no border.
- **Text buttons** (inline actions) — plain text, `hover:text-text`, no bg or border.
- **Button rows** (action lists, settings) — full-width rows with icon left, label + description stacked right, subtle border + hover state.
- **Primary action** — `bg-text text-surface hover:opacity-90` (filled button, monochrome).
- Use native `<button type="button">` for all buttons. No react-aria `Button` wrapper.

### Dropdowns & Selects
- Use **react-aria-components** `Select` and `Popover` for any dropdown. Example:

```tsx
import { Select, Label, Button, ListBox, ListBoxItem, Popover } from 'react-aria-components'

<Select>
  <Label>Quality</Label>
  <Button>← chevron indicator →</Button>
  <Popover>
    <ListBox>
      <ListBoxItem>1080p</ListBoxItem>
      <ListBoxItem>720p</ListBoxItem>
    </ListBox>
  </Popover>
</Select>
```

### Dialogs & Modals
- Use **react-aria-components** `Modal` + `Dialog` for settings, about, URL input, etc.
- Custom styled to match macOS: rounded corners, backdrop blur, centered.

### Sliders (volume / seek)
- Use native `<input type="range">` styled with Tailwind. No react-aria slider needed for basic seek/volume.

### Lists (playlist, library)
- Use react-aria-components `ListBox` for keyboard-navigable lists with selection.
- Virtualized if > 500 items.

### Drag and Drop
- Native HTML5 DnD API. No react-aria DnD — it's overkill for a media player.
- Visual feedback: `border-2 border-dashed` + backdrop blur overlay.

---

## Icon Conventions

| Use | Icon set | Prefix |
|---|---|---|
| General UI, media actions | **lucide-react** | `Lu` |
| File types, folders | **lucide-react** | `Lu` |
| Settings, navigation | **lucide-react** | `Lu` |
| _(reserved)_ Brand, decorative | **heroicons** | `Hi` / `HiOutline` |

- Always `size={16|20|24}`. 16 for inline, 20 for list items, 24 for standalone action buttons.
- Icons inherit text color via `currentColor`.

---

## Color System (Grayscale)

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--surface` | `#ffffff` | `#0a0a0a` | Main background |
| `--surface-alt` | `#f5f5f5` | `#1a1a1a` | Secondary bg, list hover |
| `--surface-hover` | `#e5e5e5` | `#262626` | Button/row hover |
| `--border` | `#d4d4d4` | `#333333` | Dividers, borders |
| `--text` | `#171717` | `#f5f5f5` | Primary text |
| `--text-muted` | `#737373` | `#a3a3a3` | Secondary text, captions |
| `--ring` | `#a3a3a3` | `#525252` | Focus rings |

No accent colors. No brand colors. Hierarchy via weight + size only.

---

## Interaction Patterns

### Keyboard Navigation
- `Tab` / `Shift+Tab` navigates focusable elements
- `Enter` / `Space` activates
- `Arrow keys` for list navigation (react-aria handles this)
- `Space` for play/pause (global)
- `Escape` closes modals, clears selection

### Animation
- **Transitions** — `transition-colors duration-150` for hover/focus, `transition-all duration-200` for layout shifts.
- **Pulse** — `animate-pulse` for drag-over feedback.
- **No spring physics** — keep it subtle. macOS doesn't bounce UI on every interaction.
- Avoid `animate-bounce` or exaggerated keyframes.

### Cursor
- `cursor-pointer` on clickable elements
- `cursor-default` by default
- No custom cursors for drag states (keep it simple)

---

## Layout Architecture

```
┌──────────────────────────────────────────┐
│  Toolbar (traffic lights + title)        │  ← draggable region
├──────────────────────────────────────────┤
│  ┌─────────┬──────────────────────────┐  │
│  │ Sidebar │    Main Content          │  │
│  │ Library │    (player / browse)     │  │
│  │ Playlist│                          │  │
│  │         │                          │  │
│  └─────────┴──────────────────────────┘  │
├──────────────────────────────────────────┤
│  Playback Controls (mini)               │  ← always visible
│  [⏮] [▶/⏸] [⏭] ───●──────── [vol]    │
└──────────────────────────────────────────┘
```

- **Sidebar** — collapsible, ~220px wide, contains library tree + playlist.
- **Main** — video canvas or browse page (the drop zone).
- **Bottom bar** — thin (48px), persistent playback controls.
- **Toolbar** — handled by Tauri's native title bar or a custom `data-tauri-drag-region`.

---

## File Structure

```
src/
├── components/
│   ├── ui/           # Primitive components (buttons, inputs via react-aria)
│   ├── player/       # Video canvas, controls overlay
│   ├── library/      # Sidebar, browser, playlist
│   ├── dialogs/      # Modals (settings, url, about)
│   └── layout/       # Shell (toolbar, sidebar shell, bottom bar)
├── hooks/            # use-theme, use-player, etc.
├── stores/           # Zustand stores
├── lib/              # Tauri IPC wrappers, utilities
├── App.tsx
└── main.tsx
```

---

## Reference: macOS Apps to Study
- **Music** (formerly iTunes) — sidebar + content layout
- **IINA** — the gold standard for macOS media player UI
- **VLC (macOS)** — what to avoid (cluttered, non-native)
- **QuickTime Player** — minimal, modal-free playback
