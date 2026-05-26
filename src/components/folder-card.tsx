import { useEffect, useRef } from 'react'
import { LuFolder, LuLoader, LuVideo, LuMusic, LuX } from 'react-icons/lu'
import type { FolderMedia } from '../stores/local-media'
import { useLocalMediaStore } from '../stores/local-media'

interface FolderCardProps {
  folder: FolderMedia
  scanning: boolean
  onClick: () => void
  deletable?: boolean
  onDelete?: () => void
}

const VIDEO_EXTS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg',
])

function isVideo(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot === -1) return false
  return VIDEO_EXTS.has(name.substring(dot).toLowerCase())
}

export function FolderCard({ folder, scanning, onClick, deletable, onDelete }: FolderCardProps) {
  const cardRef = useRef<HTMLButtonElement>(null)
  const thumbnailCache = useLocalMediaStore((s) => s.thumbnailCache)
  const loadVideoThumbnail = useLocalMediaStore((s) => s.loadVideoThumbnail)

  // Lazy load thumbnails only when the card scrolls into view
  useEffect(() => {
    const el = cardRef.current
    if (!el || folder.videos.length === 0) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Request thumbnails for the first 4 videos
          const targets = folder.videos.slice(0, 4)
          for (const v of targets) {
            loadVideoThumbnail(v.path)
          }
          observer.disconnect()
        }
      },
      { threshold: 0.1 },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [folder.videos, loadVideoThumbnail])

  const videoCount = folder.videos.filter((v) => isVideo(v.name)).length
  const audioCount = folder.videos.length - videoCount
  const displayVideos = folder.videos.slice(0, 4)

  return (
    <button
      ref={cardRef}
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-left shadow-lg transition-colors hover:bg-surface-hover"
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        <LuFolder size={18} className="shrink-0 text-text-muted" />
        <span className="min-w-0 truncate text-sm font-medium text-text">{folder.name}</span>
        {scanning && <LuLoader size={12} className="shrink-0 animate-spin text-text-muted" />}
        {deletable && onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              if (window.confirm(`Remove "${folder.name}" from the list?`)) {
                onDelete()
              }
            }}
            className="ml-auto flex shrink-0 items-center justify-center rounded p-0.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            <LuX size={14} />
          </button>
        )}
      </div>

      {folder.videos.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            {displayVideos.map((video) => {
              const thumb = thumbnailCache[video.path]
              return (
                <div
                  key={video.path}
                  className="relative aspect-video overflow-hidden rounded-lg bg-surface-alt"
                >
                  {thumb ? (
                    <img
                      src={thumb}
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
              )
            })}
          </div>

          <div className="flex items-center gap-3 text-xs text-text-muted">
            <span>{folder.videos.length} file{folder.videos.length !== 1 ? 's' : ''}</span>
            {videoCount > 0 && <span>{videoCount} video{videoCount !== 1 ? 's' : ''}</span>}
            {audioCount > 0 && <span>{audioCount} audio</span>}
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
