import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    // During development the LAN server (bun run server) answers the API and WebSocket.
    proxy: { '/api': 'http://localhost:3000', '/ws': { target: 'ws://localhost:3000', ws: true } },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
})
