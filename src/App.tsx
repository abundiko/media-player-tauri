import { usePlayerStore } from './stores/player'
import { ThemeToggle } from './components/theme-toggle'
import { DropZone } from './components/drop-zone'
import { VideoPlayer } from './components/player/video-player'

function App() {
  const filePath = usePlayerStore((s) => s.filePath)

  if (filePath) {
    return <VideoPlayer />
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <h1 className="text-base font-medium tracking-tight">Media Player</h1>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-2xl">
          <DropZone />
        </div>
      </main>
    </div>
  )
}

export default App
