import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export interface SubtitleTrack {
  index: number
  title: string
  language: string
}

export interface PlayerState {
  filePath: string | null
  fileName: string | null
  streamUrl: string | null
  blobUrl: string | null
  transcodeUrl: string | null
  needsTranscode: boolean
  timeOffset: number
  playing: boolean
  duration: number
  currentTime: number
  volume: number
  muted: boolean
  subtitleTracks: SubtitleTrack[]
  activeSubtitleTrack: number | null

  loadFile: (path: string) => Promise<void>
  enableTranscoding: () => Promise<void>
  seekTranscode: (time: number) => Promise<void>
  setPlaying: (playing: boolean) => void
  togglePlay: () => void
  setCurrentTime: (t: number) => void
  setDuration: (d: number) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  fetchSubtitleTracks: () => Promise<void>
  setActiveSubtitleTrack: (track: number | null) => void
  close: () => void
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  filePath: null,
  fileName: null,
  streamUrl: null,
  blobUrl: null,
  transcodeUrl: null,
  needsTranscode: false,
  timeOffset: 0,
  playing: false,
  duration: 0,
  currentTime: 0,
  volume: 1,
  muted: false,
  subtitleTracks: [],
  activeSubtitleTrack: null,

  loadFile: async (path: string) => {
    const parts = path.replace(/\\/g, '/').split('/')
    const fileName = parts[parts.length - 1] || path

    const prev = get().blobUrl
    if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
    set({ blobUrl: null, streamUrl: null, transcodeUrl: null, needsTranscode: false, timeOffset: 0, subtitleTracks: [], activeSubtitleTrack: null })

    // Try HTTP streaming server first
    try {
      const streamUrl = await invoke<string>('get_stream_url', { path })
      console.log('[loadFile] streamUrl:', streamUrl)
      set({ filePath: path, fileName, streamUrl, playing: true, currentTime: 0, duration: 0 })
      return
    } catch (e) {
      console.error('[loadFile] get_stream_url failed:', e)
    }

    // Fallback: read entire file into memory and create blob URL
    try {
      const bytes = await invoke<number[]>('read_file_bytes', { path })
      const uint8 = new Uint8Array(bytes)
      const mime = fileName.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'video/*'
      const blobUrl = URL.createObjectURL(new Blob([uint8], { type: mime }))
      console.log('[loadFile] blobUrl:', blobUrl, 'size:', uint8.length)
      set({ filePath: path, fileName, blobUrl, playing: true, currentTime: 0, duration: 0 })
    } catch (e) {
      console.error('[loadFile] fallback also failed:', e)
      set({ filePath: null, fileName: null, streamUrl: null, blobUrl: null, playing: false })
    }
  },

  enableTranscoding: async () => {
    const { filePath } = get()
    if (!filePath) return
    console.log('[player] switching to FFmpeg transcoding')
    try {
      // First, get the actual video duration
      let realDuration = 0
      try {
        realDuration = await invoke<number>('probe_duration', { path: filePath })
        console.log('[player] real duration from probe:', realDuration)
      } catch (e) {
        console.error('[player] probe_duration failed:', e)
      }

      const transcodeUrl = await invoke<string>('get_transcode_url', { path: filePath, seekTime: 0 })
      set({ 
        transcodeUrl, 
        streamUrl: null, 
        blobUrl: null, 
        needsTranscode: true, 
        timeOffset: 0,
        duration: realDuration > 0 ? realDuration : get().duration
      })
    } catch (e) {
      console.error('[player] enableTranscoding failed:', e)
    }
  },

  seekTranscode: async (time: number) => {
    const { filePath } = get()
    if (!filePath) return
    try {
      const transcodeUrl = await invoke<string>('get_transcode_url', { path: filePath, seekTime: time })
      set({ transcodeUrl, timeOffset: time, currentTime: time })
    } catch (e) {
      console.error('[player] seekTranscode failed:', e)
    }
  },

  setPlaying: (playing: boolean) => set({ playing }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),

  setCurrentTime: (currentTime: number) => set({ currentTime }),
  setDuration: (duration: number) => set({ duration }),
  setVolume: (volume: number) => set({ volume }),

  toggleMute: () => set((s) => ({ muted: !s.muted })),

  fetchSubtitleTracks: async () => {
    const { filePath } = get()
    if (!filePath) {
      set({ subtitleTracks: [], activeSubtitleTrack: null })
      return
    }
    try {
      const tracks = await invoke<SubtitleTrack[]>('get_subtitle_tracks', { path: filePath })
      set({ subtitleTracks: tracks, activeSubtitleTrack: tracks.length > 0 ? tracks[0].index : null })
    } catch (e) {
      console.error('[player] fetchSubtitleTracks failed:', e)
      set({ subtitleTracks: [], activeSubtitleTrack: null })
    }
  },

  setActiveSubtitleTrack: (track) => set({ activeSubtitleTrack: track }),

  close: () => {
    const prev = get().blobUrl
    if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
    set({
      filePath: null, fileName: null, streamUrl: null, blobUrl: null,
      transcodeUrl: null, needsTranscode: false, timeOffset: 0, playing: false,
      subtitleTracks: [], activeSubtitleTrack: null,
    })
  },
}))
