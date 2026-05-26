import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import { ThemeProvider } from './hooks/use-theme'
import { RootLayout } from './RootLayout'
import { HomePage } from './HomePage'
import { VideoPlayer } from './components/player/video-player'
import { YoutubePlayer } from './components/player/youtube-player'
import { ImdbPlayer } from './components/player/imdb-player'

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: '/player/video', element: <VideoPlayer /> },
      { path: '/player/youtube/:videoId', element: <YoutubePlayer /> },
      { path: '/player/imdb/:imdbId', element: <ImdbPlayer /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </StrictMode>,
)
