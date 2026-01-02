import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import postgres from 'https://deno.land/x/postgresjs/mod.js'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // Create a database connection
        const connectionString = Deno.env.get('SUPABASE_DB_URL')
        if (!connectionString) {
            throw new Error('SUPABASE_DB_URL is not set')
        }

        const sql = postgres(connectionString)

        const { query } = await req.json()

        if (!query) {
            return new Response(
                JSON.stringify({ error: 'Missing query' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Execute the query
        const result = await sql.unsafe(query)

        // Close the connection
        await sql.end()

        return new Response(
            JSON.stringify(result),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
