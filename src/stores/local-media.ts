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

export interface FolderThumbnails {
  path: string
  urls: (string | null)[]
}

export type SortKey = 'name-asc' | 'name-desc' | 'newest' | 'oldest' | 'largest' | 'smallest'

const CACHE_KEY = 'local-media-videos'

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

interface LocalMediaState {
  folders: Record<string, FolderMedia>
  scanning: Record<string, boolean>
  thumbnails: Record<string, FolderThumbnails>
  thumbnailCache: Record<string, string | null>
  loadingThumbnails: Record<string, boolean>

  initFromCache: () => void
  scanFolder: (key: string, folderPath: string, folderName: string) => Promise<void>
  loadThumbnails: (folderPath: string) => Promise<void>
  loadVideoThumbnail: (videoPath: string) => Promise<string | null>
}

export const useLocalMediaStore = create<LocalMediaState>((set, get) => ({
  folders: {},
  scanning: {},
  thumbnails: {},
  thumbnailCache: {},
  loadingThumbnails: {},

  initFromCache: () => {
    const cached = loadCache()
    const folders: Record<string, FolderMedia> = {}
    for (const [path, videos] of Object.entries(cached)) {
      folders[path] = {
        path,
        name: path.split('/').pop() || path,
        videos,
      }
    }
    set({ folders })
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

  loadThumbnails: async (folderPath: string) => {
    const folder = Object.values(get().folders).find((f) => f.path === folderPath)
    if (!folder) return

    const targets = folder.videos.slice(0, 4)
    const urls: (string | null)[] = await Promise.all(
      targets.map(async (v) => {
        try {
          return await invoke<string>('get_video_thumbnail', { path: v.path })
        } catch {
          return null
        }
      }),
    )

    set((s) => ({
      thumbnails: {
        ...s.thumbnails,
        [folderPath]: { path: folderPath, urls },
      },
    }))
  },

  loadVideoThumbnail: async (videoPath: string) => {
    const existing = get().thumbnailCache[videoPath]
    if (existing !== undefined) return existing
    if (get().loadingThumbnails[videoPath]) return null

    set((s) => ({ loadingThumbnails: { ...s.loadingThumbnails, [videoPath]: true } }))

    try {
      const url = await invoke<string | null>('get_video_thumbnail', { path: videoPath })
      set((s) => ({
        thumbnailCache: { ...s.thumbnailCache, [videoPath]: url },
        loadingThumbnails: { ...s.loadingThumbnails, [videoPath]: false },
      }))
      return url
    } catch {
      set((s) => ({
        thumbnailCache: { ...s.thumbnailCache, [videoPath]: null },
        loadingThumbnails: { ...s.loadingThumbnails, [videoPath]: false },
      }))
      return null
    }
  },
}))
