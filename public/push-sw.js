// Service Worker for Push Notifications
// CityOS Architecture: Smart decision-making with clients.matchAll()
// HARDENED: Comprehensive error handling, improved deep links

self.addEventListener('push', async (event) => {
    if (!event.data) {
        console.warn('[SW] Push event without data')
        return
    }

    try {
        const data = event.data.json()

        // CRITICAL: Check if app is currently open
        const clients = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        })

        const hasVisibleClient = clients.some(client => client.visibilityState === 'visible')

        // If app is open and visible, DON'T show push notification
        // The in-app notification will handle it
        if (hasVisibleClient) {
            console.log('[SW] App is visible, skipping push notification')
            return
        }

        // Build deep link URL based on entity type
        let targetUrl = '/'
        if (data.entity_type === 'task' && data.entity_id) {
            targetUrl = `/staff/tasks/${data.entity_id}`
        } else if (data.url) {
            targetUrl = data.url
        }

        // App is closed or hidden, show push notification
        const notificationOptions = {
            body: data.message || data.body || '',
            icon: '/icons/icon-192x192.png',
            badge: '/icons/icon-192x192.png',
            tag: data.notification_id || 'default', // Use notification_id for deduplication
            requireInteraction: false,
            vibrate: [200, 100, 200], // Subtle vibration pattern
            data: {
                url: targetUrl,
                notification_id: data.notification_id,
                entity_type: data.entity_type,
                entity_id: data.entity_id
            }
        }

        await self.registration.showNotification(
            data.title || 'TVG Flow',
            notificationOptions
        )
    } catch (error) {
        console.error('[SW] Error handling push:', error)
        // Silent error - never break UX
    }
})

self.addEventListener('notificationclick', (event) => {
    event.notification.close()

    const targetUrl = event.notification.data?.url || '/'
    const fullUrl = new URL(targetUrl, self.location.origin).href

    event.waitUntil(
        self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        }).then((clients) => {
            // Try to find existing window with same origin
            for (const client of clients) {
                const clientUrl = new URL(client.url)
                const targetUrlObj = new URL(fullUrl)

                // If same origin, navigate existing window
                if (clientUrl.origin === targetUrlObj.origin && 'navigate' in client) {
                    client.navigate(fullUrl)
                    return client.focus()
                }
            }

            // No matching window, open new one
            if (self.clients.openWindow) {
                return self.clients.openWindow(fullUrl)
            }
        }).catch(error => {
            console.error('[SW] Navigation failed:', error)
            // Fallback: try to open window anyway
            if (self.clients.openWindow) {
                return self.clients.openWindow(fullUrl)
            }
        })
    )
})

// Handle service worker activation
self.addEventListener('activate', (event) => {
    console.log('[SW] Activated')
    event.waitUntil(self.clients.claim())
})

// Handle errors
self.addEventListener('error', (event) => {
    console.error('[SW] Error:', event.error)
})

self.addEventListener('unhandledrejection', (event) => {
    console.error('[SW] Unhandled rejection:', event.reason)
})
