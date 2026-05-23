import { LuFileUp } from 'react-icons/lu'

interface DragOverlayProps {
  dragging: boolean
}

export function DragOverlay({ dragging }: DragOverlayProps) {
  if (!dragging) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-xl" style={{ background: 'var(--surface-alt)' }}>
      <div className="flex animate-pulse flex-col items-center gap-2">
        <LuFileUp size={40} className="text-text" />
        <p className="text-sm font-medium text-text">Drop to play</p>
      </div>
    </div>
  )
}
