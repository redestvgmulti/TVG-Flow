const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co'
const serviceKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'

async function checkTriggers() {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/check_all_triggers`, {
        method: 'POST',
        headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json'
        }
    })
    // If rpc doesn't exist, we can try to query pg_trigger directly if we had SQL access
    // But we have the DB URL! I can use it to query.
}

async function runQuery() {
    const { Client } = require('pg')
    const client = new Client({
        host: 'aws-0-sa-east-1.pooler.supabase.com',
        port: 6543, // Pooler port
        user: 'postgres.gyooxmpyxncrezjiljrj',
        password: 'G1eovane23*',
        database: 'postgres',
        ssl: { rejectUnauthorized: false }
    })
    
    await client.connect()
    try {
        const res = await client.query(`
            SELECT tgname, tgfoid::regproc, tgrelid::regclass
            FROM pg_trigger
            WHERE tgrelid = 'auth.users'::regclass;
        `)
        console.log('Triggers on auth.users:', res.rows)
    } finally {
        await client.end()
    }
}

runQuery()
