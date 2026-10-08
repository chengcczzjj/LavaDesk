import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const aliases = {
  '@main': resolve(__dirname, 'src/main'),
  '@preload': resolve(__dirname, 'src/preload'),
  '@renderer': resolve(__dirname, 'src/renderer'),
  '@shared': resolve(__dirname, 'src/shared'),
  '@resources': resolve(__dirname, 'resources'),
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
    resolve: { alias: aliases },
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    build: {
      rollupOptions: {
        // Sandboxed preloads cannot require local Rollup chunks, so all window bridges share one role-gated bundle.
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
        },
      },
    },
    resolve: { alias: aliases },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: 'src/renderer',
    server: {
      host: '0.0.0.0',
      port: 5174,
    },
    build: {
      rollupOptions: {
        input: {
          'main-ui': resolve(__dirname, 'src/renderer/main-ui/index.html'),
          wallpaper: resolve(__dirname, 'src/renderer/wallpaper/index.html'),
          canvas: resolve(__dirname, 'src/renderer/canvas/index.html'),
          'quick-chat': resolve(__dirname, 'src/renderer/quick-chat/index.html'),
        },
      },
    },
    resolve: { alias: aliases },
    plugins: [tailwindcss(), react()],
  },
})
