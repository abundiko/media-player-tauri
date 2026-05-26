import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export interface ScannedVideo {
  path: string
  name: string
  size: number
  modified: number
}

export interface FolderMedia {
  name: string
  path: string
  videos: ScannedVideo[]
}

export type SortKey = 'name-asc' | 'name-desc' | 'newest' | 'oldest' | 'largest' | 'smallest'

const CACHE_KEY = 'local-media-videos'
const CACHE_KEY_HISTORY = 'local-media-history'
const CACHE_KEY_EXPLICIT = 'local-media-explicit'

function loadCache(): Record<string, ScannedVideo[]> {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

function saveCache(videos: Record<string, ScannedVideo[]>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(videos))
  } catch {}
}

function loadHistoryCache(): ScannedVideo[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY_HISTORY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

function saveHistoryCache(history: ScannedVideo[]) {
  try {
    localStorage.setItem(CACHE_KEY_HISTORY, JSON.stringify(history))
  } catch {}
}

function loadExplicitCache(): string[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY_EXPLICIT)
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

function saveExplicitCache(keys: string[]) {
  try {
    localStorage.setItem(CACHE_KEY_EXPLICIT, JSON.stringify(keys))
  } catch {}
}

// ── Sequential thumbnail queue ──────────────────────────────────
// Processes one thumbnail at a time to avoid flooding the backend
// with concurrent ffmpeg processes.

type ThumbCallback = (url: string | null) => void

interface QueueItem {
  videoPath: string
  resolve: ThumbCallback
}

let thumbQueue: QueueItem[] = []
let thumbProcessing = false

async function processThumbQueue() {
  if (thumbProcessing) return
  thumbProcessing = true

  while (thumbQueue.length > 0) {
    const item = thumbQueue.shift()!
    try {
      const url = await invoke<string>('get_video_thumbnail', { path: item.videoPath })
      item.resolve(url)
    } catch {
      item.resolve(null)
    }
  }

  thumbProcessing = false
}

function enqueueThumb(videoPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    thumbQueue.push({ videoPath, resolve })
    processThumbQueue()
  })
}

// ── Store ───────────────────────────────────────────────────────

interface LocalMediaState {
  folders: Record<string, FolderMedia>
  scanning: Record<string, boolean>
  thumbnailCache: Record<string, string | null>
  loadingThumbnails: Record<string, boolean>
  explicitFolders: string[]

  initFromCache: () => void
  scanFolder: (key: string, folderPath: string, folderName: string) => Promise<void>
  loadVideoThumbnail: (videoPath: string) => void
  addToHistory: (path: string) => Promise<void>
  markExplicitFolder: (key: string) => void
  removeFolder: (key: string) => void
  clearHistory: () => void
}

export const useLocalMediaStore = create<LocalMediaState>((set, get) => ({
  folders: {},
  scanning: {},
  thumbnailCache: {},
  loadingThumbnails: {},
  explicitFolders: [],

  initFromCache: () => {
    const cached = loadCache()
    const history = loadHistoryCache()
    const explicit = loadExplicitCache()
    
    const folders: Record<string, FolderMedia> = {}
    
    // Add history folder
    folders['history'] = {
      name: 'History',
      path: 'history',
      videos: history,
    }

    for (const [path, videos] of Object.entries(cached)) {
      folders[path] = {
        path,
        name: path.split('/').pop() || path,
        videos,
      }
    }
    set({ folders, explicitFolders: explicit })
  },

  scanFolder: async (key: string, folderPath: string, folderName: string) => {
    set((s) => ({ scanning: { ...s.scanning, [key]: true } }))

    try {
      const videos = await invoke<ScannedVideo[]>('scan_video_folder', { path: folderPath })

      set((s) => ({
        folders: {
          ...s.folders,
          [key]: { name: folderName, path: folderPath, videos },
        },
        scanning: { ...s.scanning, [key]: false },
      }))

      const all = { ...loadCache(), [key]: videos }
      saveCache(all)
    } catch (e) {
      console.error('[local-media] scan failed:', e)
      set((s) => ({ scanning: { ...s.scanning, [key]: false } }))
    }
  },

  loadVideoThumbnail: (videoPath: string) => {
    const state = get()
    // Already cached or already loading — skip
    if (state.thumbnailCache[videoPath] !== undefined) return
    if (state.loadingThumbnails[videoPath]) return

    set((s) => ({ loadingThumbnails: { ...s.loadingThumbnails, [videoPath]: true } }))

    enqueueThumb(videoPath).then((url) => {
      set((s) => ({
        thumbnailCache: { ...s.thumbnailCache, [videoPath]: url },
        loadingThumbnails: { ...s.loadingThumbnails, [videoPath]: false },
      }))
    })
  },

  markExplicitFolder: (key: string) => {
    set((s) => {
      if (s.explicitFolders.includes(key)) return s
      const updated = [...s.explicitFolders, key]
      saveExplicitCache(updated)
      return { explicitFolders: updated }
    })
  },

  removeFolder: (key: string) => {
    set((s) => {
      const { [key]: _, ...rest } = s.folders
      const cache = loadCache()
      delete cache[key]
      saveCache(cache)
      const explicit = s.explicitFolders.filter((k) => k !== key)
      saveExplicitCache(explicit)
      return { folders: rest, explicitFolders: explicit }
    })
  },

  clearHistory: () => {
    saveHistoryCache([])
    set((s) => {
      if (!s.folders['history']) return s
      return {
        folders: {
          ...s.folders,
          history: { ...s.folders['history'], videos: [] },
        },
      }
    })
  },

  addToHistory: async (path: string) => {
    try {
      const meta = await invoke<ScannedVideo>('get_video_metadata', { path })
      
      set((s) => {
        const historyFolder = s.folders['history'] || {
          name: 'History',
          path: 'history',
          videos: []
        }
        
        let newVideos = [...historyFolder.videos]
        
        // Remove if it exists
        newVideos = newVideos.filter((v) => v.path !== path)
        
        // Add to the front
        newVideos.unshift(meta)
        
        // Cap to 40
        if (newVideos.length > 40) {
          newVideos = newVideos.slice(0, 40)
        }
        
        // Save to local storage
        saveHistoryCache(newVideos)

        return {
          folders: {
            ...s.folders,
            history: {
              ...historyFolder,
              videos: newVideos
            }
          }
        }
      })
    } catch (e) {
      console.error('[local-media] failed to add to history:', e)
    }
  },
}))
