import { useCallback } from 'react'
import { usePlayerStore } from '../../stores/player'
import { Button, Tooltip, TooltipTrigger } from 'react-aria-components'
import { LuVolume2, LuVolumeX } from 'react-icons/lu'

export function VolumeControl() {
  const volume = usePlayerStore((s) => s.volume)
  const muted = usePlayerStore((s) => s.muted)
  const setVolume = usePlayerStore((s) => s.setVolume)
  const toggleMute = usePlayerStore((s) => s.toggleMute)

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setVolume(Number(e.target.value))
    },
    [setVolume],
  )

  return (
    <>
      <TooltipTrigger>
        <Button
          onPress={toggleMute}
          className="flex cursor-pointer items-center justify-center text-white/50 transition-colors hover:text-white"
        >
          {muted ? <LuVolumeX size={16} /> : <LuVolume2 size={16} />}
        </Button>
        <Tooltip className="rounded bg-gray-800 px-2 py-1 text-xs text-white shadow-lg">
          {muted ? 'Unmute' : 'Mute'}
        </Tooltip>
      </TooltipTrigger>
      <span className="w-8 text-right text-xs text-white/50">{Math.round(volume * 100)}%</span>
      <input
        type="range"
        min={0}
        max={2}
        step={0.05}
        value={muted ? 0 : volume}
        onChange={handleVolumeChange}
        disabled={muted}
        className={`h-1 w-20 appearance-none rounded-full accent-white
          ${muted ? 'cursor-default opacity-40' : 'cursor-pointer'}
          bg-white/20
          [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white`}
      />
    </>
  )
}
