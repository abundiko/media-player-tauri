import { useCallback, useState, useRef, useEffect } from 'react'
import { Button, Tooltip, TooltipTrigger } from 'react-aria-components'

const SPEEDS = [0.2, 0.5, 1, 1.5, 2, 3]

interface SpeedControlProps {
  speed: number
  onChangeSpeed: (speed: number) => void
}

export function SpeedControl({ speed, onChangeSpeed }: SpeedControlProps) {
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
    (s: number) => {
      onChangeSpeed(s)
      setOpen(false)
    },
    [onChangeSpeed],
  )

  const isCustom = !SPEEDS.includes(speed)

  return (
    <div className="relative">
      <TooltipTrigger>
        <Button
          onPress={() => setOpen((o) => !o)}
          className={`flex cursor-pointer items-center justify-center rounded px-1.5 py-0.5 text-xs font-medium transition-colors hover:text-white ${
            speed !== 1 ? 'text-cyan-400' : 'text-white/50'
          }`}
        >
          {isCustom ? speed.toFixed(2) : speed}x
        </Button>
        <Tooltip className="rounded bg-gray-800 px-2 py-1 text-xs text-white shadow-lg">
          Speed
        </Tooltip>
      </TooltipTrigger>

      {open && (
        <div
          ref={menuRef}
          className="absolute bottom-full right-0 mb-2 min-w-[100px] overflow-hidden rounded-lg bg-gray-900/95 py-1 shadow-xl backdrop-blur-sm"
        >
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => select(s)}
              className={`w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-white/10 ${
                speed === s ? 'text-cyan-400' : 'text-white/70'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export { SPEEDS }
