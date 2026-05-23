import { useEffect, useCallback, useState } from 'react'
import { videoDir, downloadDir, documentDir } from '@tauri-apps/api/path'
import { useLocalMediaStore } from '../stores/local-media'
import { FolderCard } from './folder-card'
import { FolderMediaModal } from './folder-media-modal'
import type { FolderMedia } from '../stores/local-media'

interface FolderConfig {
  key: string
  label: string
  getPath: () => Promise<string>
}

const folders: FolderConfig[] = [
  { key: 'videos', label: 'Videos', getPath: videoDir },
  { key: 'downloads', label: 'Downloads', getPath: downloadDir },
  { key: 'documents', label: 'Documents', getPath: documentDir },
]

export function LocalMedia() {
  const [activeFolder, setActiveFolder] = useState<FolderMedia | null>(null)

  const foldersState = useLocalMediaStore((s) => s.folders)
  const scanning = useLocalMediaStore((s) => s.scanning)
  const thumbnails = useLocalMediaStore((s) => s.thumbnails)
  const initFromCache = useLocalMediaStore((s) => s.initFromCache)
  const scanFolder = useLocalMediaStore((s) => s.scanFolder)
  const loadThumbnailsFor = useLocalMediaStore((s) => s.loadThumbnails)

  useEffect(() => {
    initFromCache()
  }, [initFromCache])

  useEffect(() => {
    for (const f of folders) {
      f.getPath().then((folderPath) => {
        scanFolder(f.key, folderPath, f.label)
      })
    }
  }, [scanFolder])

  const handleLoadThumbnails = useCallback(
    (folderPath: string) => {
      loadThumbnailsFor(folderPath)
    },
    [loadThumbnailsFor],
  )

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <h2 className="text-sm font-medium text-text-muted">Local Media</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {folders.map((f) => {
          const folder = foldersState[f.key]
          if (!folder) return null

          return (
            <FolderCard
              key={f.key}
              folder={folder}
              scanning={!!scanning[f.key]}
              thumbnails={thumbnails[folder.path]}
              onLoadThumbnails={() => handleLoadThumbnails(folder.path)}
              onClick={() => setActiveFolder(folder)}
            />
          )
        })}
      </div>

      {activeFolder && (
        <FolderMediaModal
          folder={activeFolder}
          onClose={() => setActiveFolder(null)}
        />
      )}
    </div>
  )
}
