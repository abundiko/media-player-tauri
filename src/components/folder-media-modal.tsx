import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { LuX, LuVideo, LuMusic, LuArrowUpDown, LuSearch } from 'react-icons/lu'
import type { FolderMedia, ScannedVideo, SortKey } from '../stores/local-media'
import { useLocalMediaStore } from '../stores/local-media'
import { usePlayerStore } from '../stores/player'

interface FolderMediaModalProps {
  folder: FolderMedia
  onClose: () => void
}

const VIDEO_EXTS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg',
])

function isVideo(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot === -1) return false
  return VIDEO_EXTS.has(name.substring(dot).toLowerCase())
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const val = bytes / Math.pow(1024, i)
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatDate(secs: number): string {
  try {
    return new Date(secs * 1000).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    })
  } catch {
    return '—'
  }
}

const sortOptions: { key: SortKey; label: string }[] = [
  { key: 'name-asc', label: 'Name A-Z' },
  { key: 'name-desc', label: 'Name Z-A' },
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'largest', label: 'Largest' },
  { key: 'smallest', label: 'Smallest' },
]

function sortVideos(videos: ScannedVideo[], sort: SortKey): ScannedVideo[] {
  const arr = [...videos]
  switch (sort) {
    case 'name-asc':
      arr.sort((a, b) => a.name.localeCompare(b.name))
      break
    case 'name-desc':
      arr.sort((a, b) => b.name.localeCompare(a.name))
      break
    case 'newest':
      arr.sort((a, b) => b.modified - a.modified)
      break
    case 'oldest':
      arr.sort((a, b) => a.modified - b.modified)
      break
    case 'largest':
      arr.sort((a, b) => b.size - a.size)
      break
    case 'smallest':
      arr.sort((a, b) => a.size - b.size)
      break
  }
  return arr
}

export function FolderMediaModal({ folder, onClose }: FolderMediaModalProps) {
  const [sort, setSort] = useState<SortKey>('name-asc')
  const [showSort, setShowSort] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const thumbnailCache = useLocalMediaStore((s) => s.thumbnailCache)
  const loadVideoThumbnail = useLocalMediaStore((s) => s.loadVideoThumbnail)

  // Auto-focus search on mount
  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  const sorted = useMemo(() => {
    const filtered = searchQuery
      ? folder.videos.filter((v) => v.name.toLowerCase().includes(searchQuery.toLowerCase()))
      : folder.videos
    return sortVideos(filtered, sort)
  }, [folder.videos, sort, searchQuery])

  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 100,
    overscan: 10,
    measureElement: (element) => element?.getBoundingClientRect().height,
  })

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const loadFile = usePlayerStore((s) => s.loadFile)

  const handlePlay = useCallback(
    (path: string) => {
      onClose()
      loadFile(path)
    },
    [onClose, loadFile],
  )

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
      >
        {/* backdrop */}
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* modal */}
        <motion.div
          className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-border bg-surface shadow-2xl"
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        >
          {/* header */}
          <div className="border-b border-border">
            <div className="flex items-center justify-between gap-4 px-5 py-4">
              <motion.h2
                className="truncate text-lg font-semibold text-text"
                layout="position"
                transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              >
                {folder.name}
              </motion.h2>

              <div className="flex items-center gap-2">
                {/* sort button */}
                <div className="relative">
                  <button
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-hover"
                    onClick={() => setShowSort((s) => !s)}
                  >
                    <LuArrowUpDown size={13} />
                    {sortOptions.find((o) => o.key === sort)?.label}
                  </button>

                  {showSort && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setShowSort(false)}
                      />
                      <motion.div
                        className="absolute right-0 top-full z-50 mt-1 min-w-[140px] overflow-hidden rounded-xl border border-border bg-surface/80 p-1 shadow-xl backdrop-blur-xl"
                        initial={{ opacity: 0, y: -4, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.96 }}
                        transition={{ duration: 0.12 }}
                      >
                        {sortOptions.map((opt) => (
                          <button
                            key={opt.key}
                            className={`flex w-full items-center rounded-lg px-3 py-1.5 text-left text-xs transition-colors ${
                              sort === opt.key
                                ? 'bg-surface-hover text-text'
                                : 'text-text-muted hover:bg-surface-hover'
                            }`}
                            onClick={() => {
                              setSort(opt.key)
                              setShowSort(false)
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </motion.div>
                    </>
                  )}
                </div>

                {/* close */}
                <button
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-text-muted transition-colors hover:bg-red-500/20 hover:text-red-400"
                  onClick={onClose}
                >
                  <LuX size={16} />
                </button>
              </div>
            </div>

            {/* search */}
            <div className="px-5 pb-3">
              <div className="relative">
                <LuSearch
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                />
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Filter files…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface-alt py-2 pl-9 pr-3 text-sm text-text outline-none placeholder:text-text-muted/60 transition-colors focus:border-text-muted"
                />
              </div>
            </div>
          </div>

          {/* list */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-5">
            {sorted.length === 0 ? (
              <p className="text-center text-sm text-text-muted">No media files found</p>
            ) : (
              <div
                className="relative w-full"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualizer.getVirtualItems().map((virtualItem) => {
                  const video = sorted[virtualItem.index]
                  return (
                    <div
                      key={virtualItem.key}
                      data-index={virtualItem.index}
                      ref={virtualizer.measureElement}
                      className="absolute left-0 top-0 w-full pb-2"
                      style={{
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                    >
                      <MediaTile
                        video={video}
                        thumbnail={thumbnailCache[video.path]}
                        onLoadThumbnail={() => loadVideoThumbnail(video.path)}
                        onPlay={() => handlePlay(video.path)}
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* footer */}
          <div className="border-t border-border px-5 py-3 text-xs text-text-muted">
            {sorted.length} / {folder.videos.length} file{folder.videos.length !== 1 ? 's' : ''}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

interface MediaTileProps {
  video: ScannedVideo
  thumbnail: string | null | undefined
  onLoadThumbnail: () => void
  onPlay: () => void
}

function MediaTile({ video, thumbnail, onLoadThumbnail, onPlay }: MediaTileProps) {
  const tileRef = useRef<HTMLButtonElement>(null)

  // Load thumbnail only when the tile scrolls into view
  useEffect(() => {
    if (thumbnail !== undefined) return

    const el = tileRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onLoadThumbnail()
          observer.disconnect()
        }
      },
      { threshold: 0.1 },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [thumbnail, onLoadThumbnail])

  const isVid = isVideo(video.name)

  return (
    <motion.button
      ref={tileRef}
      className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-2.5 text-left transition-colors hover:bg-surface-hover"
      onClick={onPlay}
    >
      {/* thumbnail */}
      <div className="aspect-video h-16 shrink-0 overflow-hidden rounded-lg bg-surface-alt sm:h-20">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {isVid ? (
              <LuVideo size={18} className="text-text-muted" />
            ) : (
              <LuMusic size={18} className="text-text-muted" />
            )}
          </div>
        )}
      </div>

      {/* info */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-text">
          {video.name}
        </span>
        <span className="text-xs text-text-muted">
          {isVid ? 'Video' : 'Audio'} &middot; {formatSize(video.size)}
        </span>
        <span className="text-xs text-text-muted">
          {formatDate(video.modified)}
        </span>
      </div>
    </motion.button>
  )
}
