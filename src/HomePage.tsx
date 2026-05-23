import { open } from '@tauri-apps/plugin-dialog'
import { LuFileUp, LuLink, LuFolderOpen, LuSettings } from 'react-icons/lu'
import { usePlayerStore } from './stores/player'
import { LocalMedia } from './components/local-media'

const MEDIA_FILTERS = [
  { name: 'Media files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', 'mp3', 'flac', 'wav', 'aac', 'ogg', 'opus', 'm4a', 'wma', 'ac3', 'dts'] },
  { name: 'Video files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg'] },
  { name: 'Audio files', extensions: ['mp3', 'flac', 'wav', 'aac', 'ogg', 'opus', 'm4a', 'wma', 'ac3', 'dts'] },
  { name: 'All files', extensions: ['*'] },
]

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

export function HomePage() {
  const loadFile = usePlayerStore((s) => s.loadFile)

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
    }
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-6 py-3">
        {actions.map(({ label, icon: Icon }) => (
          <button
            key={label}
            type="button"
            onClick={() => handleAction(label)}
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-text-muted transition-all hover:border-text hover:bg-surface-hover hover:text-text"
          >
            <Icon size={16} className="shrink-0" />
            <span className="font-medium">{label}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-1 flex-col">
        <LocalMedia />
      </div>
    </div>
  )
}
