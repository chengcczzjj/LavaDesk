import { exposeMainUiApi } from './main-ui'
import { exposeCanvasApi } from './canvas'
import { exposeWallpaperApi } from './wallpaper'

const roleArgument = process.argv.find((argument) => argument.startsWith('--lingyue-window-role='))
const role = roleArgument?.slice('--lingyue-window-role='.length)

if (role === 'main') {
  exposeMainUiApi()
} else if (role === 'canvas') {
  exposeCanvasApi()
} else if (role === 'wallpaper') {
  exposeWallpaperApi()
} else {
  throw new Error('缺少有效的 LavaDesk 窗口角色，preload 已拒绝暴露 IPC bridge。')
}
