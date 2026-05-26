import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { useLocalMediaStore } from './local-media'
import { getResumePosition } from './resume'

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
  isWebUrl: boolean
  playing: boolean
  duration: number
  currentTime: number
  volume: number
  muted: boolean
  subtitleTracks: SubtitleTrack[]
  activeSubtitleTrack: number | null
  isSystemFfmpeg: boolean

  loadFile: (path: string) => Promise<void>
  enableTranscoding: (speed?: number) => Promise<void>
  seekTranscode: (time: number, speed?: number) => Promise<void>
  setPlaying: (playing: boolean) => void
  togglePlay: () => void
  setCurrentTime: (t: number) => void
  setDuration: (d: number) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  fetchSubtitleTracks: () => Promise<void>
  setActiveSubtitleTrack: (track: number | null) => void
  checkSystemFfmpeg: () => Promise<void>
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
  isWebUrl: false,
  playing: false,
  duration: 0,
  currentTime: 0,
  volume: 1,
  muted: false,
  subtitleTracks: [],
  activeSubtitleTrack: null,
  isSystemFfmpeg: false,

  loadFile: async (path: string) => {
    const isUrl = path.startsWith('http://') || path.startsWith('https://')
    const parts = path.replace(/\\/g, '/').split('/')
    const fileName = parts[parts.length - 1] || path

    const state = get()
    if (state.filePath === path) {
      console.log('[loadFile] already loaded, skipping:', path)
      return
    }

    const prev = state.blobUrl
    if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
    set({ blobUrl: null, streamUrl: null, transcodeUrl: null, needsTranscode: false, timeOffset: 0, subtitleTracks: [], activeSubtitleTrack: null, isWebUrl: false })

    if (isUrl) {
      console.log('[loadFile] web URL detected:', path)
      set({ filePath: path, fileName, streamUrl: path, playing: true, currentTime: 0, duration: 0, isWebUrl: true })
      return
    }

    // Add to history (local files only)
    useLocalMediaStore.getState().addToHistory(path)

    // Fallback: set filePath + streamUrl so the video element attempts playback.
    // If it fails (unsupported codec), the video-player component's error handler
    // will automatically switch to the transcoding pipeline, which streams
    // incrementally instead of loading the whole file into RAM.
    try {
      const streamUrl = await invoke<string>('get_stream_url', { path })
      console.log('[loadFile] streamUrl:', streamUrl)
      set({ filePath: path, fileName, streamUrl, playing: true, currentTime: 0, duration: 0 })
    } catch (e) {
      console.error('[loadFile] get_stream_url failed, cannot load file:', e)
      set({ filePath: null, fileName: null, streamUrl: null, blobUrl: null, playing: false })
    }
  },

  enableTranscoding: async (speed: number = 1) => {
    const { filePath } = get()
    if (!filePath) return
    console.log('[player] switching to FFmpeg transcoding, speed:', speed)
    try {
      // First, get the actual video duration
      let realDuration = 0
      try {
        realDuration = await invoke<number>('probe_duration', { path: filePath })
        console.log('[player] real duration from probe:', realDuration)
      } catch (e) {
        console.error('[player] probe_duration failed:', e)
      }

      const resumePos = getResumePosition(filePath)
      const seekTime = resumePos ?? 0
      const transcodeUrl = await invoke<string>('get_transcode_url', { path: filePath, seekTime, speed })
      console.log('[player] transcodeUrl:', transcodeUrl)
      set({ 
        transcodeUrl, 
        streamUrl: null, 
        blobUrl: null, 
        needsTranscode: true, 
        timeOffset: seekTime,
        duration: realDuration > 0 ? realDuration : get().duration
      })
      console.log('[player] transcoding enabled, new src set')
    } catch (e) {
      console.error('[player] enableTranscoding failed:', e)
    }
  },

  seekTranscode: async (time: number, speed?: number) => {
    const { filePath } = get()
    if (!filePath) return
    const s = speed ?? 1
    try {
      const transcodeUrl = await invoke<string>('get_transcode_url', { path: filePath, seekTime: time, speed: s })
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
    const { filePath, isWebUrl } = get()
    if (!filePath || isWebUrl) {
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

  checkSystemFfmpeg: async () => {
    try {
      const isSystem = await invoke<boolean>('is_using_system_ffmpeg')
      set({ isSystemFfmpeg: isSystem })
    } catch (e) {
      console.error('[player] checkSystemFfmpeg failed:', e)
    }
  },

  close: () => {
    const prev = get().blobUrl
    if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
    set({
      filePath: null, fileName: null, streamUrl: null, blobUrl: null,
      transcodeUrl: null, needsTranscode: false, timeOffset: 0, isWebUrl: false, playing: false,
      subtitleTracks: [], activeSubtitleTrack: null,
    })
  },
}))
