import { supabase } from './supabase'

// VAPID Public Key - You need to generate this with web-push
// Run: npx web-push generate-vapid-keys
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
 */
export async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        throw new Error('Service Worker não suportado neste navegador')
    }

    try {
        // Em produção, o VitePWA gera o sw.js (que importa o push-sw.js)
        // Em desenvolvimento, usamos diretamente o push-sw.js
        const swUrl = import.meta.env.PROD ? '/sw.js' : '/push-sw.js'

        const registration = await navigator.serviceWorker.register(swUrl)

        // Wait for it to be ready
        await navigator.serviceWorker.ready

        return registration
    } catch (error) {
        console.error('Erro ao registrar Service Worker:', error)
        throw error
    }
}

/**
 * Request notification permission
 */
export async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        console.warn('Notifications not supported')
        return 'denied'
    }

    if (Notification.permission === 'granted') {
        return 'granted'
    }

    if (Notification.permission !== 'denied') {
        const permission = await Notification.requestPermission()
        return permission
    }

    return Notification.permission
}

/**
 * Subscribe to push notifications
 */
export async function subscribeToPush(professionalId) {
    try {
        // Check if already subscribed
        const registration = await navigator.serviceWorker.ready
        let subscription = await registration.pushManager.getSubscription()

        if (!subscription) {
            // Create new subscription
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
            })
        }

        // Save subscription to database
        const subscriptionData = subscription.toJSON()

        console.log('Sending subscription to server:', {
            profissional_id: professionalId,
            endpoint: subscriptionData.endpoint
        })

        // Check if keys are ArrayBuffer (rare but possible in some polyfills/browsers)
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
            onConflict: 'profissional_id, endpoint'
        })

        if (error) {
            console.error('Supabase upsert error:', error)
            throw error
        }

        console.log('Push subscription saved successfully')
        return subscription
    } catch (error) {
        console.error('Error subscribing to push:', error)
        throw error
    }
}

/**
 * Unsubscribe from push notifications
 */
export async function unsubscribeFromPush() {
    try {
        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.getSubscription()

        if (subscription) {
            await subscription.unsubscribe()

            // Remove from database
            const subscriptionData = subscription.toJSON()
            await supabase
                .from('push_subscriptions')
                .delete()
                .eq('endpoint', subscriptionData.endpoint)

            console.log('Unsubscribed from push')
        }
    } catch (error) {
        console.error('Error unsubscribing:', error)
        throw error
    }
}

/**
 * Check if user is subscribed to push
 */
export async function isPushSubscribed() {
    try {
        if (!('serviceWorker' in navigator)) return false

        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.getSubscription()

        return !!subscription
    } catch (error) {
        console.error('Error checking subscription:', error)
        return false
    }
}
