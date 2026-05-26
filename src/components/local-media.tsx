import { useEffect } from "react";
import { videoDir, downloadDir, documentDir } from "@tauri-apps/api/path";
import { useLocalMediaStore } from "../stores/local-media";
import { FolderCard } from "./folder-card";
import { FolderMediaModal } from "./folder-media-modal";
import type { FolderMedia } from "../stores/local-media";

interface FolderConfig {
  key: string;
  label: string;
  getPath: () => Promise<string>;
}

const folders: FolderConfig[] = [
  { key: "videos", label: "Videos", getPath: videoDir },
  { key: "downloads", label: "Downloads", getPath: downloadDir },
  { key: "documents", label: "Documents", getPath: documentDir },
];

interface LocalMediaProps {
  activeFolder: FolderMedia | null
  onOpenFolder: (folder: FolderMedia) => void
  onCloseFolder: () => void
}

export function LocalMedia({ activeFolder, onOpenFolder, onCloseFolder }: LocalMediaProps) {
  const foldersState = useLocalMediaStore((s) => s.folders);
  const scanning = useLocalMediaStore((s) => s.scanning);
  const initFromCache = useLocalMediaStore((s) => s.initFromCache);
  const scanFolder = useLocalMediaStore((s) => s.scanFolder);

  useEffect(() => {
    initFromCache();
  }, [initFromCache]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      for (const f of folders) {
        if (cancelled) break;
        const folderPath = await f.getPath();
        if (cancelled) break;
        await scanFolder(f.key, folderPath, f.label);
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [scanFolder]);

  const defaultKeys = new Set(folders.map((f) => f.key))
  const removeFolder = useLocalMediaStore((s) => s.removeFolder)
  const clearHistory = useLocalMediaStore((s) => s.clearHistory)

  return (
    <div className="flex flex-col gap-4 p-6">
      <h2 className="text-sm font-medium text-text-muted">Local Media</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {foldersState['history'] && foldersState['history'].videos.length > 0 && (
          <FolderCard
            key="history"
            folder={foldersState['history']}
            scanning={false}
            onClick={() => onOpenFolder(foldersState['history'])}
            deletable
            onDelete={clearHistory}
          />
        )}
        {folders.map((f) => {
          const folder = foldersState[f.key];
          if (!folder) return null;

          return (
            <FolderCard
              key={f.key}
              folder={folder}
              scanning={!!scanning[f.key]}
              onClick={() => onOpenFolder(folder)}
            />
          );
        })}
        {Object.entries(foldersState).map(([key, folder]) => {
          if (key === 'history' || defaultKeys.has(key)) return null;
          if (folder.videos.length === 0) return null;
          return (
            <FolderCard
              key={key}
              folder={folder}
              scanning={false}
              onClick={() => onOpenFolder(folder)}
              deletable
              onDelete={() => removeFolder(key)}
            />
          );
        })}
      </div>

      {activeFolder && (
        <FolderMediaModal
          folder={activeFolder}
          onClose={onCloseFolder}
        />
      )}
    </div>
  );
}
