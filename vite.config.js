import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

// Generate version identifier for update banner
const commitHash = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return Date.now().toString()
  }
})()

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(commitHash),
  },
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
        skipWaiting: true, // Force new SW to take control immediately (fixes hidden alerts)
        navigateFallback: '/index.html', // Offline fallback for navigation requests
        navigateFallbackDenylist: [
          /^\/api\//,  // Never fallback for API routes
          /^\/__\//,   // Vite internal routes
          /\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|woff2)$/  // Static assets
        ],
        runtimeCaching: [
          // 🔐 AUTH ROUTES — NEVER CACHE (CRITICAL FIX FOR MOBILE LOGOUT)
          // iOS/Android clear SW cache in background, but NOT localStorage.
          // If auth routes are cached, token refresh fails → forced logout.
          // Solution: Always fetch auth from network, never from cache.
          {
            urlPattern: /^https:\/\/gyooxmpyxncrezjiljrj\.supabase\.co\/auth\/.*$/,
            handler: 'NetworkOnly', // ← CRITICAL: No caching for auth
          },

          // 📊 DATA API — NETWORK FIRST WITH CACHE FALLBACK
          // Rest API can be cached for performance, but prioritize fresh data
          {
            urlPattern: /^https:\/\/gyooxmpyxncrezjiljrj\.supabase\.co\/rest\/.*$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-data-api',
              networkTimeoutSeconds: 10,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 // 24 hours
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },

          // 📦 STORAGE (FILES) — CACHE FIRST FOR PERFORMANCE
          // Static assets can be heavily cached
          {
            urlPattern: /^https:\/\/gyooxmpyxncrezjiljrj\.supabase\.co\/storage\/.*$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'supabase-storage',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 7 // 7 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },

          // 🎨 GOOGLE FONTS — CACHE FIRST (UNCHANGED)
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      },
      devOptions: {
        enabled: process.env.VITE_SW_DEV === 'true', // Enable with: VITE_SW_DEV=true npm run dev
        type: 'module'
      }
    })
  ],
  build: {
    // Remove console.log/debug but keep error/warn for debugging
    minify: 'esbuild',
    target: 'esnext',
    esbuild: {
      drop: ['debugger'],
      pure: ['console.log', 'console.debug']
    }
  }
})
