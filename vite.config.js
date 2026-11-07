import { defineConfig } from 'vite'
export default defineConfig({
  resolve: {
    alias: { three: 'super-three' }
  },
  build: { chunkSizeWarningLimit: 3000 }
})
