import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt', // User requirement: "New version available. Update now?"
      includeAssets: ['icons/*.png', 'offline.html'],
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']
      },
      manifest: false, // Usa o manifest.json do /public
      workbox: {
        importScripts: ['/push-sw.js'], // Import push notification logic
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
        clientsClaim: false, // Prevent auto-takeover to avoid auth race conditions
        skipWaiting: false, // Prevent silent takeover - user must confirm update
        // navigateFallback: 'index.html', // Ensure SPA routing works offline if needed
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/gyooxmpyxncrezjiljrj\.supabase\.co\/.*$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 // 24 horas
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 ano
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      },
      devOptions: {
        enabled: false, // DISABLED: Service Worker breaks auth in dev mode
        type: 'module'
      }
    })
  ],
  build: {
    // Remove all console statements in production for security
    minify: 'esbuild',
    target: 'esnext',
    esbuild: {
      drop: ['console', 'debugger']
    }
  }
})
