import { useEffect } from 'react'
import { usePlayerStore } from '../../stores/player'

interface KeyboardHandlerProps {
  onTogglePlay: () => void
  onToggleFullscreen: () => void
  onSkipBack: () => void
  onSkipForward: () => void
  onShowIndicator: (type: string, label?: string) => void
}

export function KeyboardHandler({
  onTogglePlay,
  onToggleFullscreen,
  onSkipBack,
  onSkipForward,
  onShowIndicator,
}: KeyboardHandlerProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLTextAreaElement) return;
      if (target instanceof HTMLInputElement && target.type !== 'range') return;
      if (target.closest('button, [role="button"]')) return;

      switch (e.key) {
        case ' ':
        case 'p':
          e.preventDefault()
          onShowIndicator(usePlayerStore.getState().playing ? 'pause' : 'play')
          onTogglePlay()
          break
        case 'f':
          e.preventDefault()
          onShowIndicator('fullscreen', document.fullscreenElement ? 'OFF' : 'ON')
          onToggleFullscreen()
          break
        case 'ArrowLeft':
          e.preventDefault()
          onShowIndicator('backward', '-10s')
          onSkipBack()
          break
        case 'ArrowRight':
          e.preventDefault()
          onShowIndicator('forward', '+10s')
          onSkipForward()
          break
        case 'ArrowUp': {
          e.preventDefault()
          onShowIndicator('volume-up', '+10')
          const { volume, setVolume } = usePlayerStore.getState()
          setVolume(Math.min(2, volume + 0.1))
          break
        }
        case 'ArrowDown': {
          e.preventDefault()
          onShowIndicator('volume-down', '-10')
          const { volume, setVolume } = usePlayerStore.getState()
          setVolume(Math.max(0, volume - 0.1))
          break
        }
      }
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onTogglePlay, onToggleFullscreen, onSkipBack, onSkipForward, onShowIndicator])

  return null
}
