import { useState, useCallback, type DragEvent } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { LuFileUp, LuLink, LuFolderOpen, LuSettings } from 'react-icons/lu'
import { usePlayerStore } from '../stores/player'

const MEDIA_FILTERS = [
  { name: 'Media files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', 'mp3', 'flac', 'wav', 'aac', 'ogg', 'opus', 'm4a', 'wma', 'ac3', 'dts'] },
  { name: 'Video files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg'] },
  { name: 'Audio files', extensions: ['mp3', 'flac', 'wav', 'aac', 'ogg', 'opus', 'm4a', 'wma', 'ac3', 'dts'] },
  { name: 'All files', extensions: ['*'] },
]

const MEDIA_EXTS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg',
  '.mp3', '.flac', '.wav', '.aac', '.ogg', '.opus', '.m4a', '.wma', '.ac3', '.dts',
])

function isMediaFile(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot === -1) return false
  return MEDIA_EXTS.has(name.substring(dot).toLowerCase())
}

interface ActionButton {
  label: string
  icon: typeof LuFileUp
  description: string
}

const actions: ActionButton[] = [
  { label: 'Select file', icon: LuFileUp, description: 'Browse local media files' },
  { label: 'Web URL', icon: LuLink, description: 'Stream from a web address' },
  { label: 'Select folder', icon: LuFolderOpen, description: 'Open all media in a folder' },
  { label: 'Settings', icon: LuSettings, description: 'Configure preferences' },
]

export function DropZone() {
  const [dragging, setDragging] = useState(false)
  const [dropEffect, setDropEffect] = useState<'idle' | 'valid' | 'invalid'>('idle')
  const loadFile = usePlayerStore((s) => s.loadFile)

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
    const files = Array.from(e.dataTransfer.items)
    setDropEffect(files.some((f) => f.kind === 'file') ? 'valid' : 'invalid')
  }, [])

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    setDropEffect('idle')
  }, [])

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    setDropEffect('idle')

    const files = Array.from(e.dataTransfer.files).filter((f) => isMediaFile(f.name))
    if (files.length > 0) {
      loadFile(files[0].name)
    }
  }, [loadFile])

  const handleAction = async (label: string) => {
    switch (label) {
      case 'Select file': {
        const selected = await open({
          multiple: false,
          filters: MEDIA_FILTERS,
        })
        if (selected) {
          loadFile(selected)
        }
        break
      }
      case 'Settings': {
        break
      }
    }
  }

  const borderColor = dropEffect === 'valid' ? 'border-text' : dropEffect === 'invalid' ? 'border-text-muted' : 'border-border'
  const bgColor = dragging ? 'bg-surface-alt' : 'bg-transparent'

  return (
    <div
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative flex flex-col items-center justify-center gap-8 rounded-xl border-2 border-dashed px-8 py-16 transition-all duration-200 ${borderColor} ${bgColor}`}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-surface/60 backdrop-blur-sm">
          <div className="flex animate-pulse flex-col items-center gap-2">
            <LuFileUp size={40} className="text-text" />
            <p className="text-sm font-medium text-text">
              {dropEffect === 'valid' ? 'Drop to play' : 'Media files only'}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col items-center gap-2">
        <LuFileUp size={36} className="text-text-muted" />
        <p className="text-sm text-text-muted">Drop a media file here</p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-1.5">
        {actions.map(({ label, icon: Icon, description }) => (
          <button
            key={label}
            type="button"
            onClick={() => handleAction(label)}
            className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-4 py-3 text-left text-text-muted transition-all hover:border-text hover:bg-surface-hover hover:text-text"
          >
            <Icon size={20} className="shrink-0" />
            <div className="flex flex-col">
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-text-muted">{description}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
