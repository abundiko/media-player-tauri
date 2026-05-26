import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { LuFileUp, LuLink, LuFolderOpen } from "react-icons/lu";
import { usePlayerStore } from "./stores/player";
import { useLocalMediaStore } from "./stores/local-media";
import { LocalMedia } from "./components/local-media";
import { FolderMediaModal } from "./components/folder-media-modal";
import { WebUrlModal } from "./components/web-url-modal";
import type { FolderMedia } from "./stores/local-media";

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
];

export function HomePage() {
  const loadFile = usePlayerStore((s) => s.loadFile);
  const scanFolder = useLocalMediaStore((s) => s.scanFolder);
  const foldersState = useLocalMediaStore((s) => s.folders);
  const [activeFolder, setActiveFolder] = useState<FolderMedia | null>(null);
  const [webUrlOpen, setWebUrlOpen] = useState(false);

  const handleAction = async (label: string) => {
    const markExplicitFolder = useLocalMediaStore.getState().markExplicitFolder;
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
      case "Web URL": {
        setWebUrlOpen(true);
        break;
      }
      case "Select folder": {
        const selected = await open({ directory: true, multiple: false });
        if (selected) {
          const key = selected;
          const name = selected.replace(/\\/g, '/').split('/').pop() || selected;

          if (!foldersState[key]) {
            await scanFolder(key, selected, name);
          }

          markExplicitFolder(key);

          const folder = foldersState[key] || useLocalMediaStore.getState().folders[key];
          if (folder) setActiveFolder(folder);
        }
        break;
      }
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-surface px-6 py-3">
        {actions.map(({ label, icon: Icon }) => (
          <button
            key={label}
            type="button"
            onClick={() => handleAction(label)}
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-text-muted transition-all hover:border-text hover:bg-surface-hover hover:text-text"
          >
            <Icon size={16} className="shrink-0" />
            <span className="font-medium">{label}</span>
          </button>
        ))}
      </div>
      <LocalMedia activeFolder={activeFolder} onOpenFolder={setActiveFolder} onCloseFolder={() => setActiveFolder(null)} />

      {activeFolder && (
        <FolderMediaModal
          folder={activeFolder}
          onClose={() => setActiveFolder(null)}
        />
      )}

      {webUrlOpen && (
        <WebUrlModal onClose={() => setWebUrlOpen(false)} />
      )}
    </div>
  );
}
