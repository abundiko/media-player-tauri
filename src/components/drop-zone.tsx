import { open } from "@tauri-apps/plugin-dialog";
import { LuFileUp, LuLink, LuFolderOpen } from "react-icons/lu";
import { usePlayerStore } from "../stores/player";

const MEDIA_FILTERS = [
  {
    name: "Media files",
    extensions: [
      "mp4",
      "mkv",
      "avi",
      "mov",
      "wmv",
      "flv",
      "webm",
      "m4v",
      "mpg",
      "mpeg",
      "mp3",
      "flac",
      "wav",
      "aac",
      "ogg",
      "opus",
      "m4a",
      "wma",
      "ac3",
      "dts",
    ],
  },
  {
    name: "Video files",
    extensions: [
      "mp4",
      "mkv",
      "avi",
      "mov",
      "wmv",
      "flv",
      "webm",
      "m4v",
      "mpg",
      "mpeg",
    ],
  },
  {
    name: "Audio files",
    extensions: [
      "mp3",
      "flac",
      "wav",
      "aac",
      "ogg",
      "opus",
      "m4a",
      "wma",
      "ac3",
      "dts",
    ],
  },
  { name: "All files", extensions: ["*"] },
];

export const MEDIA_EXTS = new Set([
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".wmv",
  ".flv",
  ".webm",
  ".m4v",
  ".mpg",
  ".mpeg",
  ".mp3",
  ".flac",
  ".wav",
  ".aac",
  ".ogg",
  ".opus",
  ".m4a",
  ".wma",
  ".ac3",
  ".dts",
]);

export function isMediaFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return false;
  return MEDIA_EXTS.has(name.substring(dot).toLowerCase());
}

interface ActionButton {
  label: string;
  icon: typeof LuFileUp;
  description: string;
}

const actions: ActionButton[] = [
  {
    label: "Select file",
    icon: LuFileUp,
    description: "Browse local media files",
  },
  { label: "Web URL", icon: LuLink, description: "Stream from a web address" },
  {
    label: "Select folder",
    icon: LuFolderOpen,
    description: "Open all media in a folder",
  },
  // { label: 'Settings', icon: LuSettings, description: 'Configure preferences' },
];

export function DropZone() {
  const loadFile = usePlayerStore((s) => s.loadFile);

  const handleAction = async (label: string) => {
    switch (label) {
      case "Select file": {
        const selected = await open({
          multiple: false,
          filters: MEDIA_FILTERS,
        });
        if (selected) {
          loadFile(selected);
        }
        break;
      }
      case "Settings": {
        break;
      }
    }
  };

  return (
    <div className="relative flex flex-col items-center justify-center gap-8 rounded-xl border-2 border-dashed border-border px-8 py-16 transition-all duration-200">
      <div className="flex flex-col items-center gap-2">
        <LuFileUp size={36} className="text-text-muted" />
        <p className="text-sm text-text-muted">Drop a media file here</p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-1.5">
        {actions.map(({ label, icon: Icon, description }) => (
          <button
            key={label}
            type="button"
            onClick={() => handleAction(label)}
            className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-4 py-3 text-left text-text-muted transition-all hover:border-text hover:bg-surface-hover hover:text-text"
          >
            <Icon size={20} className="shrink-0" />
            <div className="flex flex-col">
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-text-muted">{description}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
