/// <reference types="vitest/config" />
import { existsSync, readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Optional dev HTTPS (phones only allow the microphone on secure pages): point these at a local
// self-signed certificate. Unset -> plain http as before.
const certFile = process.env.DEV_HTTPS_CERT
const keyFile = process.env.DEV_HTTPS_KEY
const https = certFile && keyFile && existsSync(certFile) && existsSync(keyFile)
  ? { cert: readFileSync(certFile), key: readFileSync(keyFile) }
  : undefined

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    https,
    // Lets phones on the LAN use one origin: VITE_API_BASE_URL=/api/v1 is forwarded to the local backend.
    proxy: { '/api': { target: process.env.DEV_API_PROXY ?? 'http://127.0.0.1:8000', changeOrigin: true } },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rolldownOptions: {
      output: {
        // Libraries change far less often than app code: separate long-cached chunks mean a
        // redeploy only costs phones the small app chunk.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/, priority: 3 },
            { name: 'firebase', test: /node_modules[\\/](@firebase|firebase)[\\/]/, priority: 2 },
            { name: 'vendor', test: /node_modules[\\/](@tanstack|@radix-ui|clsx)[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Tests never see a developer's local .env: mocks stay off unless a test opts in.
    env: { VITE_USE_MOCKS: '' },
  },
})
