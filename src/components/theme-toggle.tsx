import { useTheme } from '../hooks/use-theme'
import { LuSun, LuMoon } from 'react-icons/lu'

export function ThemeToggle() {
  const { theme, toggle } = useTheme()

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle theme"
      className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-text-muted transition-colors hover:bg-surface-alt hover:text-text"
    >
      {theme === 'dark' ? <LuSun size={16} /> : <LuMoon size={16} />}
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  )
}
