import { useCallback, useState, useRef, useEffect } from 'react'
import { Button, Tooltip, TooltipTrigger } from 'react-aria-components'
import { LuMonitor } from 'react-icons/lu'

const FIT_KEY = 'media-player-fit'

export interface FitOption {
  id: string
  label: string
  objectFit: React.CSSProperties['objectFit']
}

export const FIT_OPTIONS: FitOption[] = [
  { id: 'best-fit', label: 'Best fit', objectFit: 'contain' },
  { id: 'fill', label: 'Fill', objectFit: 'cover' },
  { id: 'stretch', label: 'Stretch', objectFit: 'fill' },
  { id: 'center', label: 'Center', objectFit: 'none' },
]

export function getSavedFit(): string {
  try {
    return localStorage.getItem(FIT_KEY) || 'best-fit'
  } catch {
    return 'best-fit'
  }
}

export function saveFit(id: string): void {
  try {
    localStorage.setItem(FIT_KEY, id)
  } catch {}
}

interface FitControlProps {
  fit: string
  onChangeFit: (id: string) => void
}

export function FitControl({ fit, onChangeFit }: FitControlProps) {
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
    (id: string) => {
      onChangeFit(id)
      saveFit(id)
      setOpen(false)
    },
    [onChangeFit],
  )

  return (
    <div className="relative">
      <TooltipTrigger>
        <Button
          onPress={() => setOpen((o) => !o)}
          className={`flex cursor-pointer items-center justify-center transition-colors hover:text-white ${
            fit !== 'best-fit' ? 'text-cyan-400' : 'text-white/50'
          }`}
        >
          <LuMonitor size={16} />
        </Button>
        <Tooltip className="rounded bg-gray-800 px-2 py-1 text-xs text-white shadow-lg">
          Fit
        </Tooltip>
      </TooltipTrigger>

      {open && (
        <div
          ref={menuRef}
          className="absolute bottom-full right-0 mb-2 min-w-[140px] overflow-hidden rounded-lg bg-gray-900/95 py-1 shadow-xl backdrop-blur-sm"
        >
          {FIT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => select(opt.id)}
              className={`w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-white/10 ${
                fit === opt.id ? 'text-cyan-400' : 'text-white/70'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
