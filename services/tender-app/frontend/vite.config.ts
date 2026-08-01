import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  base: process.env.TENDER_BASE_PATH || '/apps/tender/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../frontend-dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:9977',
        changeOrigin: true,
      },
    },
  },
})
