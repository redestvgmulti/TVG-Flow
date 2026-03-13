import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

import fs from 'node:fs/promises'
import path from 'node:path'

// Generate version identifier for update banner
const commitHash = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
})()

const pkg = JSON.parse(await fs.readFile('./package.json', 'utf-8'))
const APP_VERSION = `${pkg.version}+${commitHash}`

// Custom plugin to keep system-version.json in sync
const VersionSyncPlugin = () => ({
  name: 'version-sync-plugin',
  async buildStart() {
    const versionPath = path.resolve('public/system-version.json')
    const content = {
      min_version: pkg.version,
      latest_version: pkg.version,
      force_update: false, // Default to false, can be manually set to true if needed
      message: "Nova versão disponível",
      commit: commitHash,
      timestamp: new Date().toISOString()
    }
    await fs.writeFile(versionPath, JSON.stringify(content, null, 2))
    console.log(`[VersionSync] Updated public/system-version.json to ${pkg.version}+${commitHash}`)
  }
})

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [
    VitePWA({
      registerType: 'prompt', // Definitive fix: UI controls update via prompt
      includeAssets: ['icons/*.png', 'offline.html'],
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']
      },
      manifest: false, // Usa o manifest.json do /public
      workbox: {
        importScripts: ['/push-sw.js'], // Import push notification logic
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true, // Part 8 - Service Worker Improvement
        skipWaiting: true, // Force new SW to take control immediately
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
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024 // 5MB limit for precaching
      },
      devOptions: {
        enabled: true, // Enabled for testing and consistency
        type: 'module'
      }
    }),
    react(),
    VersionSyncPlugin(),
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
