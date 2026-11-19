import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    // A single three.js instance for the app and the Spline loader
    dedupe: ['three']
  },
  build: {
    target: 'es2022', // top-level await (translations are loaded before the page renders)
    chunkSizeWarningLimit: 3000
  }
})
