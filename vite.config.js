import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: { three: 'super-three' }
  },
  build: {
    target: 'es2022', // top-level await (translations are loaded before the page renders)
    chunkSizeWarningLimit: 3000
  }
})
