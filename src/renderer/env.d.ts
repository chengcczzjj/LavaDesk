/// <reference types="vite/client" />
import type { LingyueApi } from '../preload/main-ui'
import type { WallpaperPreload } from '../preload/wallpaper'
import type { CanvasPreload } from '../preload/canvas'
import type { QuickChatApi } from '../preload/quick-chat'

declare global {
  interface Window {
    lingyue: LingyueApi
    wallpaperBridge: WallpaperPreload
    canvasBridge: CanvasPreload
    quickChat: QuickChatApi
  }
}

declare module '*.css' {
  const content: string
  export default content
}
declare module '*.png' {
  const content: string
  export default content
}
declare module '*.svg' {
  const content: string
  export default content
}
