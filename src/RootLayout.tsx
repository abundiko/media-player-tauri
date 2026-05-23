import { useState, useEffect, useRef } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { usePlayerStore } from './stores/player'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isMediaFile } from './components/drop-zone'
import { DragOverlay } from './components/drag-overlay'
import { ErrorModal } from './components/error-modal'

export function RootLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const filePath = usePlayerStore((s) => s.filePath)
  const loadFile = usePlayerStore((s) => s.loadFile)
  const [dragging, setDragging] = useState(false)
  const [errorModalOpen, setErrorModalOpen] = useState(false)
  const listenerRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (filePath && location.pathname !== '/player/video') {
      navigate('/player/video')
    } else if (!filePath && location.pathname !== '/') {
      navigate('/')
    }
  }, [filePath, navigate, location.pathname])

  useEffect(() => {
    let cancelled = false

    const setup = async () => {
      try {
        const unlisten = await getCurrentWindow().onDragDropEvent((event) => {
          const payload = event.payload

          switch (payload.type) {
            case 'enter':
              console.log('[drag] Tauri drag-enter, paths:', payload.paths)
              setDragging(true)
              break
            case 'over':
              setDragging(true)
              break
            case 'leave':
              console.log('[drag] Tauri drag-leave')
              setDragging(false)
              break
            case 'drop': {
              setDragging(false)
              console.log('[drag] Tauri drop, paths:', payload.paths)
              if (payload.paths.length > 0) {
                console.log('[drag] file:', payload.paths[0])
                if (isMediaFile(payload.paths[0])) {
                  console.log('[drag] loading file:', payload.paths[0])
                  loadFile(payload.paths[0])
                } else {
                  console.log('[drag] unsupported format, showing error modal')
                  setErrorModalOpen(true)
                }
              }
              break
            }
          }
        })

        if (cancelled) {
          unlisten()
          return
        }

        if (listenerRef.current) {
          listenerRef.current()
        }
        listenerRef.current = unlisten
        console.log('[drag] Tauri drag-drop listener registered')
      } catch (e) {
        if (!cancelled) {
          console.error('[drag] failed to setup Tauri drag-drop listener:', e)
        }
      }
    }

    setup()

    return () => {
      cancelled = true
      if (listenerRef.current) {
        listenerRef.current()
        listenerRef.current = null
        console.log('[drag] Tauri drag-drop listener removed')
      }
    }
  }, [loadFile])

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
      className="min-h-dvh"
    >
      <DragOverlay dragging={dragging} />
      <ErrorModal isOpen={errorModalOpen} onOpenChange={setErrorModalOpen} />
      <Outlet />
    </div>
  )
}
