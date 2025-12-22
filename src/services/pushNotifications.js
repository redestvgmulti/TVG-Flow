import { supabase } from './supabase'

// VAPID Public Key
const VAPID_PUBLIC_KEY = 'BL_jX1CHwA3_0Na2LqMtRp20o5z6lVMjzRXjqCW2yeLro-3O7-EGasNmCViwLzBzuehZgO1e5pU2kYMsaA15zxc'

/**
 * Convert VAPID key from base64 to Uint8Array
 */
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')

    const rawData = window.atob(base64)
    const outputArray = new Uint8Array(rawData.length)

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i)
    }
    return outputArray
}

/**
 * Register Service Worker
 * HARDENED: Never throws, returns null on error
 */
export async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        console.warn('[Push] Service Worker not supported')
        return null
    }

    try {
        const swUrl = import.meta.env.PROD ? '/sw.js' : '/push-sw.js'
        const registration = await navigator.serviceWorker.register(swUrl)
        await navigator.serviceWorker.ready
        return registration
    } catch (error) {
        console.error('[Push] SW registration failed:', error)
        // Silent error - never break UX
        return null
    }
}

/**
 * Request notification permission
 * HARDENED: Never throws, returns 'denied' on error
 */
export async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        console.warn('[Push] Notifications not supported')
        return 'denied'
    }

    try {
        if (Notification.permission === 'granted') {
            return 'granted'
        }

        if (Notification.permission !== 'denied') {
            const permission = await Notification.requestPermission()
            return permission
        }

        return Notification.permission
    } catch (error) {
        console.error('[Push] Permission request failed:', error)
        return 'denied'
    }
}

/**
 * Subscribe to push notifications
 * HARDENED: Comprehensive error handling
 */
export async function subscribeToPush(professionalId) {
    if (!professionalId) {
        console.error('[Push] Missing professionalId')
        return null
    }

    try {
        const registration = await navigator.serviceWorker.ready
        if (!registration) {
            throw new Error('Service Worker not ready')
        }

        let subscription = await registration.pushManager.getSubscription()

        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
            })
        }

        const subscriptionData = subscription.toJSON()

        if (!subscriptionData.keys || !subscriptionData.keys.p256dh || !subscriptionData.keys.auth) {
            throw new Error('Push subscription missing encryption keys')
        }

        // Convert keys to base64 strings if needed
        const p256dh = typeof subscriptionData.keys.p256dh === 'string'
            ? subscriptionData.keys.p256dh
            : btoa(String.fromCharCode.apply(null, new Uint8Array(subscriptionData.keys.p256dh)))

        const auth = typeof subscriptionData.keys.auth === 'string'
            ? subscriptionData.keys.auth
            : btoa(String.fromCharCode.apply(null, new Uint8Array(subscriptionData.keys.auth)))

        const { error } = await supabase.from('push_subscriptions').upsert({
            profissional_id: professionalId,
            endpoint: subscriptionData.endpoint,
            p256dh_key: p256dh,
            auth_key: auth,
            updated_at: new Date().toISOString(),
        }, {
            onConflict: 'profissional_id,endpoint'
        })

        if (error) {
            console.error('[Push] Database upsert error:', error)
            throw error
        }

        console.log('[Push] Subscription saved successfully')
        return subscription
    } catch (error) {
        console.error('[Push] Subscribe failed:', error)
        // Silent error - never break UX
        return null
    }
}

/**
 * Unsubscribe from push notifications
 * HARDENED: Never throws
 */
export async function unsubscribeFromPush() {
    try {
        const registration = await navigator.serviceWorker.ready
        if (!registration) {
            return
        }

        const subscription = await registration.pushManager.getSubscription()

        if (subscription) {
            await subscription.unsubscribe()

            const subscriptionData = subscription.toJSON()
            await supabase
                .from('push_subscriptions')
                .delete()
                .eq('endpoint', subscriptionData.endpoint)

            console.log('[Push] Unsubscribed successfully')
        }
    } catch (error) {
        console.error('[Push] Unsubscribe failed:', error)
        // Silent error - never break UX
    }
}

/**
 * Check if user is subscribed to push
 * HARDENED: Never throws, returns false on error
 */
export async function isPushSubscribed() {
    try {
        if (!('serviceWorker' in navigator)) {
            return false
        }

        const registration = await navigator.serviceWorker.ready
        if (!registration) {
            return false
        }

        const subscription = await registration.pushManager.getSubscription()
        return !!subscription
    } catch (error) {
        console.error('[Push] Check subscription failed:', error)
        return false
    }
}
