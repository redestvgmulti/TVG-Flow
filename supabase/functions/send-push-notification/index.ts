import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'https://esm.sh/web-push@3.6.6'

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
        // Get notification data from request
        const { notificationId } = await req.json() as NotificationPayload

        if (!notificationId) {
            throw new Error('notificationId is required')
        }

        // Create Supabase client with service role
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // Fetch notification details
        const { data: notification, error: notifError } = await supabaseAdmin
            .from('notifications')
            .select('profissional_id, title, message')
            .eq('id', notificationId)
            .single()

        if (notifError || !notification) {
            throw new Error('Notification not found')
        }

        // Fetch user's push subscriptions
        const { data: subscriptions, error: subError } = await supabaseAdmin
            .from('push_subscriptions')
            .select('*')
            .eq('profissional_id', notification.profissional_id)

        if (subError) {
            throw new Error('Error fetching subscriptions')
        }

        if (!subscriptions || subscriptions.length === 0) {
            console.log('No subscriptions found for user')
            return new Response(
                JSON.stringify({ success: true, message: 'No subscriptions' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // VAPID keys
        const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
        const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')

        if (!vapidPublicKey || !vapidPrivateKey) {
            throw new Error('VAPID keys not configured')
        }

        webpush.setVapidDetails(
            'mailto:contato@tvgflow.com',
            vapidPublicKey,
            vapidPrivateKey
        )

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
                })

                await webpush.sendNotification(pushSubscription, payload)
                return { success: true, endpoint: sub.endpoint }
            } catch (error: any) {
                console.error('Push failed for subscription:', error)

                // If subscription is invalid (410 Gone or 404 Not Found), delete it
                if (error.statusCode === 410 || error.statusCode === 404) {
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
        console.error('Error:', error)
        return new Response(
            JSON.stringify({ error: error.message || 'Internal Server Error' }),
            {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
        )
    }
})
