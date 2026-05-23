import { useEffect } from 'react'
import { LuFolder, LuLoader, LuVideo, LuMusic } from 'react-icons/lu'
import type { FolderMedia, FolderThumbnails } from '../stores/local-media'

interface FolderCardProps {
  folder: FolderMedia
  scanning: boolean
  thumbnails?: FolderThumbnails
  onLoadThumbnails: () => void
  onClick: () => void
}

const VIDEO_EXTS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg',
])

function isVideo(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot === -1) return false
  return VIDEO_EXTS.has(name.substring(dot).toLowerCase())
}

export function FolderCard({ folder, scanning, thumbnails, onLoadThumbnails, onClick }: FolderCardProps) {
  useEffect(() => {
    if (folder.videos.length > 0 && !thumbnails) {
      onLoadThumbnails()
    }
  }, [folder.videos.length, thumbnails, onLoadThumbnails])

  const videoCount = folder.videos.filter((v) => isVideo(v.name)).length
  const audioCount = folder.videos.length - videoCount
  const displayVideos = folder.videos.slice(0, 4)

  return (
    <button
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-left shadow-lg transition-colors hover:bg-surface-hover"
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        <LuFolder size={18} className="text-text-muted" />
        <span className="text-sm font-medium text-text">{folder.name}</span>
        {scanning && <LuLoader size={12} className="animate-spin text-text-muted" />}
      </div>

      {folder.videos.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            {displayVideos.map((video, i) => (
              <div
                key={video.path}
                className="relative aspect-video overflow-hidden rounded-lg bg-surface-alt"
              >
                {thumbnails?.urls[i] ? (
                  <img
                    src={thumbnails.urls[i]!}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    {isVideo(video.name) ? (
                      <LuVideo size={16} className="text-text-muted" />
                    ) : (
                      <LuMusic size={16} className="text-text-muted" />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 text-xs text-text-muted">
            <span>{folder.videos.length} file{folder.videos.length !== 1 ? 's' : ''}</span>
            {videoCount > 0 && <span>{videoCount} video{videoCount !== 1 ? 's' : ''}</span>}
            {audioCount > 0 && <span>{audioCount} audio{audioCount !== 1 ? '' : ''}</span>}
          </div>
        </>
      ) : (
        !scanning && (
          <p className="text-xs text-text-muted">No media files found</p>
        )
      )}
    </button>
  )
}
