import { useCallback, useState, useRef, useEffect } from 'react'
import { usePlayerStore } from '../../stores/player'
import { Button, Tooltip, TooltipTrigger } from 'react-aria-components'
import { LuCaptions, LuFileUp } from 'react-icons/lu'

const EXT_ID = -1

interface SubtitleControlProps {
  onPickFile: () => void
  externalFileName: string | null
}

export function SubtitleControl({ onPickFile, externalFileName }: SubtitleControlProps) {
  const subtitleTracks = usePlayerStore((s) => s.subtitleTracks)
  const activeSubtitleTrack = usePlayerStore((s) => s.activeSubtitleTrack)
  const setActiveSubtitleTrack = usePlayerStore((s) => s.setActiveSubtitleTrack)

  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const select = useCallback(
    (track: number | null) => {
      setActiveSubtitleTrack(track)
      setOpen(false)
    },
    [setActiveSubtitleTrack],
  )

  const isActive = (id: number | null) => activeSubtitleTrack === id

  // Only show the CC button if there's something to show (tracks, external, or pickable)
  if (subtitleTracks.length === 0 && !externalFileName) {
    return (
      <div className="relative">
        <TooltipTrigger>
          <Button
            onPress={() => setOpen((o) => !o)}
            className="flex cursor-pointer items-center justify-center text-white/50 transition-colors hover:text-white"
          >
            <LuCaptions size={16} />
          </Button>
          <Tooltip className="rounded bg-gray-800 px-2 py-1 text-xs text-white shadow-lg">
            Subtitles
          </Tooltip>
        </TooltipTrigger>

        {open && (
          <div
            ref={menuRef}
            className="absolute bottom-full right-0 mb-2 min-w-[180px] overflow-hidden rounded-lg border border-border py-1 shadow-lg backdrop-blur-xl"
            style={{ background: 'var(--surface-alt)' }}
          >
            <button
              onClick={() => select(null)}
              className={`w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface-hover ${
                isActive(null) ? 'text-cyan-400' : 'text-text-muted'
              }`}
            >
              Off
            </button>
            <div className="border-t border-border" />
            <button
              onClick={onPickFile}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              <LuFileUp size={12} />
              Select file...
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="relative">
      <TooltipTrigger>
        <Button
          onPress={() => setOpen((o) => !o)}
          className={`flex cursor-pointer items-center justify-center transition-colors hover:text-white ${
            activeSubtitleTrack !== null ? 'text-cyan-400' : 'text-white/50'
          }`}
        >
          <LuCaptions size={16} />
        </Button>
        <Tooltip className="rounded bg-gray-800 px-2 py-1 text-xs text-white shadow-lg">
          Subtitles
        </Tooltip>
      </TooltipTrigger>

      {open && (
        <div
          ref={menuRef}
          className="absolute bottom-full right-0 mb-2 min-w-[180px] overflow-hidden rounded-lg border border-border py-1 shadow-lg backdrop-blur-xl"
          style={{ background: 'var(--surface-alt)' }}
        >
          <button
            onClick={() => select(null)}
            className={`w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface-hover ${
              isActive(null) ? 'text-cyan-400' : 'text-text-muted'
            }`}
          >
            Off
          </button>

          {subtitleTracks.map((track) => (
            <button
              key={track.index}
              onClick={() => select(track.index)}
              className={`w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface-hover ${
                isActive(track.index) ? 'text-cyan-400' : 'text-text-muted'
              }`}
            >
              {track.title}
              {track.language && (
                <span className="ml-2 text-[10px] text-text-muted">{track.language}</span>
              )}
            </button>
          ))}

          {externalFileName && (
            <button
              onClick={() => select(EXT_ID)}
              className={`w-full truncate px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface-hover ${
                isActive(EXT_ID) ? 'text-cyan-400' : 'text-text-muted'
              }`}
            >
              {externalFileName}
            </button>
          )}

          <div className="border-t border-border" />
          <button
            onClick={onPickFile}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            <LuFileUp size={12} />
            Select file...
          </button>
        </div>
      )}
    </div>
  )
}
