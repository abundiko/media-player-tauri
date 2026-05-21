import { Button, Tooltip, TooltipTrigger } from 'react-aria-components'
import { LuPlay, LuPause, LuSkipBack, LuSkipForward, LuMaximize2, LuMinimize2 } from 'react-icons/lu'
import { ProgressBar } from './progress-bar'
import { VolumeControl } from './volume-control'
import { SubtitleControl } from './subtitle-control'

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface PlayerControlsProps {
  currentTime: number
  duration: number
  playing: boolean
  fullscreen: boolean
  onSeek: (time: number) => void
  onTogglePlay: () => void
  onSkipBack: () => void
  onSkipForward: () => void
  onToggleFullscreen: () => void
  onPickSubtitleFile: () => void
  externalSubtitleFileName: string | null
}

export function PlayerControls({
  currentTime,
  duration,
  playing,
  fullscreen,
  onSeek,
  onTogglePlay,
  onSkipBack,
  onSkipForward,
  onToggleFullscreen,
  onPickSubtitleFile,
  externalSubtitleFileName,
}: PlayerControlsProps) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
      <ProgressBar onSeek={onSeek} />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TooltipTrigger>
            <Button
              onPress={onSkipBack}
              className="flex cursor-pointer items-center gap-1 text-xs text-white/60 hover:text-white"
            >
              <LuSkipBack size={14} />
              <span>10s</span>
            </Button>
            <Tooltip className="rounded bg-gray-800 px-2 py-1 text-xs text-white shadow-lg">
              Back 10s
            </Tooltip>
          </TooltipTrigger>

          <TooltipTrigger>
            <Button
              onPress={onTogglePlay}
              className="flex cursor-pointer items-center justify-center rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
            >
              {playing ? (
                <LuPause size={18} fill="currentColor" />
              ) : (
                <LuPlay size={18} fill="currentColor" />
              )}
            </Button>
            <Tooltip className="rounded bg-gray-800 px-2 py-1 text-xs text-white shadow-lg">
              {playing ? 'Pause' : 'Play'}
            </Tooltip>
          </TooltipTrigger>

          <TooltipTrigger>
            <Button
              onPress={onSkipForward}
              className="flex cursor-pointer items-center gap-1 text-xs text-white/60 hover:text-white"
            >
              <span>10s</span>
              <LuSkipForward size={14} />
            </Button>
            <Tooltip className="rounded bg-gray-800 px-2 py-1 text-xs text-white shadow-lg">
              Forward 10s
            </Tooltip>
          </TooltipTrigger>

          <span className="text-xs text-white/50">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <SubtitleControl
            onPickFile={onPickSubtitleFile}
            externalFileName={externalSubtitleFileName}
          />
          <VolumeControl />
          <TooltipTrigger>
            <Button
              onPress={onToggleFullscreen}
              className="flex cursor-pointer items-center justify-center text-white/50 transition-colors hover:text-white"
            >
              {fullscreen ? <LuMinimize2 size={16} /> : <LuMaximize2 size={16} />}
            </Button>
            <Tooltip className="rounded bg-gray-800 px-2 py-1 text-xs text-white shadow-lg">
              {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            </Tooltip>
          </TooltipTrigger>
        </div>
      </div>
    </div>
  )
}
