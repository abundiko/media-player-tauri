import { create } from 'zustand'

const STORAGE_KEY = 'caste-equalizer'

export interface VideoFilters {
  brightness: number
  contrast: number
  saturation: number
  hueRotate: number
  blur: number
  grayscale: number
  sepia: number
}

export const BAND_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

export const VIDEO_PRESETS: Record<string, Partial<VideoFilters>> = {
  default: { brightness: 100, contrast: 100, saturation: 100, hueRotate: 0, blur: 0, grayscale: 0, sepia: 0 },
  vivid: { brightness: 110, contrast: 120, saturation: 130, hueRotate: 0, blur: 0, grayscale: 0, sepia: 0 },
  cinematic: { brightness: 90, contrast: 135, saturation: 85, hueRotate: 3, blur: 0, grayscale: 0, sepia: 0 },
  vintage: { brightness: 90, contrast: 90, saturation: 70, hueRotate: 0, blur: 0, grayscale: 0, sepia: 25 },
  noir: { brightness: 70, contrast: 150, saturation: 0, hueRotate: 0, blur: 0, grayscale: 100, sepia: 0 },
}

export const AUDIO_PRESETS: Record<string, number[]> = {
  default: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  classical: [4, 2, 0, 0, 0, 0, 0, 0, 2, 4],
  dance: [5, 3, 1, 0, 0, 0, 0, 1, 3, 5],
  rock: [4, 2, -1, -2, 0, 2, 3, 4, 3, 2],
  jazz: [3, 2, 1, 1, 0, 0, 0, 1, 2, 3],
  pop: [-1, 0, 2, 3, 4, 3, 2, 0, -1, -1],
}

interface StoredData {
  video: VideoFilters
  audio: number[]
  videoPreset: string
  audioPreset: string
}

function load(): StoredData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {
    video: { brightness: 100, contrast: 100, saturation: 100, hueRotate: 0, blur: 0, grayscale: 0, sepia: 0 },
    audio: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    videoPreset: 'default',
    audioPreset: 'default',
  }
}

function save(data: StoredData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {}
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null

function debouncedSave(data: StoredData) {
  if (saveTimeout) clearTimeout(saveTimeout)
  saveTimeout = setTimeout(() => save(data), 150)
}

interface EqualizerState {
  video: VideoFilters
  audio: number[]
  videoPreset: string
  audioPreset: string
  setVideoFilter: (key: keyof VideoFilters, value: number) => void
  applyVideoPreset: (preset: string) => void
  setAudioBand: (index: number, gain: number) => void
  applyAudioPreset: (preset: string) => void
  init: () => void
}

export const useEqualizerStore = create<EqualizerState>((set, get) => ({
  ...load(),

  init: () => {
    const data = load()
    set(data)
  },

  setVideoFilter: (key, value) => {
    set((s) => {
      const video = { ...s.video, [key]: value }
      const next = { ...s, video, videoPreset: 'custom' as string }
      debouncedSave(next)
      return next
    })
  },

  applyVideoPreset: (preset) => {
    const values = VIDEO_PRESETS[preset]
    if (!values) return
    const video = { ...get().video, ...values }
    const next = { ...get(), video, videoPreset: preset }
    save(next)
    set(next)
  },

  setAudioBand: (index, gain) => {
    set((s) => {
      const audio = [...s.audio]
      audio[index] = gain
      const next = { ...s, audio, audioPreset: 'custom' as string }
      debouncedSave(next)
      return next
    })
  },

  applyAudioPreset: (preset) => {
    const bands = AUDIO_PRESETS[preset]
    if (!bands) return
    const next = { ...get(), audio: [...bands], audioPreset: preset }
    save(next)
    set(next)
  },
}))
