import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface NotificationPayload {
    notificationId: string
}

interface PushSubscription {
    id: string
    endpoint: string
    p256dh_key: string
    auth_key: string
}

serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        console.log(`[Push] Incomming request: ${req.method}`)

        // Get notification data from request
        let body
        try {
            body = await req.json()
        } catch (e) {
            console.error('[Push] Failed to parse JSON body', e)
            return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: corsHeaders })
        }

        const notificationId = body.notificationId || (body.record && body.record.id) || (body.payload && body.payload.record && body.payload.record.id)

        console.log(`[Push] Processing notificationId: ${notificationId}`)

        if (!notificationId) {
            console.error('[Push] Missing notificationId in payload', body)
            return new Response(JSON.stringify({ error: 'notificationId is required' }), { status: 400, headers: corsHeaders })
        }

        // Create Supabase client with service role
        const supabaseUrl = Deno.env.get('SUPABASE_URL')
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

        if (!supabaseUrl || !supabaseKey) {
            console.error('[Push] Missing Supabase env vars')
            throw new Error('Server configuration error: Missing Supabase credentials')
        }

        const supabaseAdmin = createClient(supabaseUrl, supabaseKey)

        // Fetch notification details
        const { data: notification, error: notifError } = await supabaseAdmin
            .from('notifications')
            .select('profissional_id, title, message')
            .eq('id', notificationId)
            .single()

        if (notifError || !notification) {
            console.error('[Push] Notification not found or db error', notifError)
            // Return 200 to stop retries if it's just not found
            return new Response(JSON.stringify({ error: 'Notification not found' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        console.log(`[Push] Found notification for user: ${notification.profissional_id}`)

        // Fetch user's push subscriptions
        const { data: subscriptions, error: subError } = await supabaseAdmin
            .from('push_subscriptions')
            .select('*')
            .eq('profissional_id', notification.profissional_id)

        if (subError) {
            console.error('[Push] Error fetching subscriptions', subError)
            throw new Error('Database error fetching subscriptions')
        }

        if (!subscriptions || subscriptions.length === 0) {
            console.log('[Push] No subscriptions found for user')
            return new Response(
                JSON.stringify({ success: true, message: 'No subscriptions active' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        console.log(`[Push] Found ${subscriptions.length} subscriptions`)

        // VAPID keys
        const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
        const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')

        if (!vapidPublicKey || !vapidPrivateKey) {
            console.error('[Push] Missing VAPID keys')
            throw new Error('Server configuration error: Missing VAPID keys')
        }

        try {
            webpush.setVapidDetails(
                'mailto:contato@tvgflow.com',
                vapidPublicKey,
                vapidPrivateKey
            )
        } catch (vapidError) {
            console.error('[Push] Failed to set VAPID details', vapidError)
            throw new Error('VAPID configuration failed')
        }

        // Send push to all subscriptions
        const pushPromises = (subscriptions as PushSubscription[]).map(async (sub) => {
            try {
                const pushSubscription = {
                    endpoint: sub.endpoint,
                    keys: {
                        p256dh: sub.p256dh_key,
                        auth: sub.auth_key,
                    },
                }

                const payload = JSON.stringify({
                    title: notification.title,
                    message: notification.message,
                    icon: '/icon-192x192.png',
                    badge: '/badge-72x72.png',
                    timestamp: Date.now(),
                    url: '/staff/tasks' // Action URL
                })

                await webpush.sendNotification(pushSubscription, payload)
                return { success: true, endpoint: sub.endpoint }
            } catch (error: any) {
                console.error('[Push] Send failed for sub:', sub.id, error)

                // If subscription is invalid (410 Gone or 404 Not Found), delete it
                if (error.statusCode === 410 || error.statusCode === 404) {
                    console.log('[Push] Removing invalid subscription:', sub.id)
                    await supabaseAdmin
                        .from('push_subscriptions')
                        .delete()
                        .eq('id', sub.id)
                }

                return { success: false, endpoint: sub.endpoint, error: error.message || 'Unknown error' }
            }
        })

        const results = await Promise.all(pushPromises)
        const successCount = results.filter(r => r.success).length
        console.log(`[Push] Sent ${successCount}/${results.length} notifications`)

        return new Response(
            JSON.stringify({
                success: true,
                sent: successCount,
                total: subscriptions.length,
                results,
            }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
        )
    } catch (error: any) {
        console.error('[Push] Unhandled error:', error)
        return new Response(
            JSON.stringify({ error: error.message || 'Internal Server Error', stack: error.stack }),
            {
                status: 500, // Still return 500 for unhandled, but now with JSON body
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
        )
    }
})
