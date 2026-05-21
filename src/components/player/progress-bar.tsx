import { useCallback, useRef, useState } from 'react'
import { usePlayerStore } from '../../stores/player'

export function ProgressBar({ onSeek }: { onSeek: (time: number) => void }) {
  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const needsTranscode = usePlayerStore((s) => s.needsTranscode)
  const seekTranscode = usePlayerStore((s) => s.seekTranscode)

  const seekTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [dragTime, setDragTime] = useState<number | null>(null)

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const t = Number(e.target.value)

      if (needsTranscode) {
        setDragTime(t)
        if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current)
        seekTimeoutRef.current = setTimeout(() => {
          seekTranscode(t)
          setDragTime(null)
        }, 1000)
      } else {
        onSeek(t)
        setDragTime(t)
      }
    },
    [needsTranscode, onSeek, seekTranscode],
  )

  const handleMouseUp = useCallback(() => {
    if (!needsTranscode) {
      setDragTime(null)
    }
  }, [needsTranscode])

  return (
    <input
      type="range"
      min={0}
      max={duration || 0}
      step={0.1}
      value={dragTime !== null ? dragTime : currentTime}
      onChange={handleChange}
      onMouseUp={handleMouseUp}
      onKeyUp={handleMouseUp}
      className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/20 accent-white
        [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
    />
  )
}
