// Service Worker for Push Notifications
// This file handles push events and displays notifications

self.addEventListener('install', (event) => {
    console.log('Service Worker installing...')
    self.skipWaiting()
})

self.addEventListener('activate', (event) => {
    console.log('Service Worker activating...')
    event.waitUntil(clients.claim())
})

// Handle push notifications
self.addEventListener('push', (event) => {
    console.log('Push notification received:', event)

    if (!event.data) {
        console.log('No data in push event')
        return
    }

    try {
        const data = event.data.json()
        console.log('Push data:', data)

        const options = {
            body: data.message || 'Nova notificação',
            icon: data.icon || '/icon-192x192.png',
            badge: data.badge || '/badge-72x72.png',
            vibrate: [200, 100, 200],
            tag: 'tvg-flow-notification',
            requireInteraction: false,
            data: {
                url: data.url || '/',
                timestamp: data.timestamp || Date.now(),
            },
        }

        event.waitUntil(
            self.registration.showNotification(data.title || 'TVG Flow', options)
        )
    } catch (error) {
        console.error('Error showing notification:', error)
    }
})

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
    console.log('Notification clicked:', event)

    event.notification.close()

    const urlToOpen = event.notification.data?.url || '/'

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // Check if there's already a window open
            for (const client of clientList) {
                if (client.url === urlToOpen && 'focus' in client) {
                    return client.focus()
                }
            }
            // If not, open a new window
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen)
            }
        })
    )
})

// Handle notification close
self.addEventListener('notificationclose', (event) => {
    console.log('Notification closed:', event)
})
