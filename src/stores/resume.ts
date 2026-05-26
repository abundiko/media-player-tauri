const STORAGE_KEY = 'caste-resume'

function load(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

function save(data: Record<string, number>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {}
}

export function getResumePosition(path: string): number | null {
  const pos = load()[path]
  return pos && pos > 0 ? pos : null
}

export function setResumePosition(path: string, position: number) {
  const data = load()
  data[path] = Math.round(position / 10) * 10
  save(data)
}

export function clearResumePosition(path: string) {
  const data = load()
  delete data[path]
  save(data)
}
