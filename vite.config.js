import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    // A single three.js instance for the app and the Spline loader
    dedupe: ['three'],
    alias: {
      // Unoff UI design tokens (CSS only; the package exports its React
      // components only, so its stylesheets are reached by path)
      '@unoff-styles': fileURLToPath(new URL('./node_modules/@unoff/ui/dist/assets/styles', import.meta.url))
    }
  },
  build: {
    target: 'es2022', // top-level await (translations are loaded before the page renders)
    chunkSizeWarningLimit: 3000
  }
})
