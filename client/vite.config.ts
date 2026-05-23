import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Allows any localtunnel URL so you don't have to keep updating this
    allowedHosts: true, 
    host: true // Also ensures it listens on all network interfaces
  }
})