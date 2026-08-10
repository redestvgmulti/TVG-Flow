const { Client } = require('pg')

const client = new Client({
    host: 'db.gyooxmpyxncrezjiljrj.supabase.co',
    port: 5432,
    user: 'postgres',
    password: 'G1eovane23*',
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
})

async function run() {
    await client.connect()
    try {
        const res = await client.query(`
            SELECT conname, pg_get_constraintdef(oid)
            FROM pg_constraint
            WHERE conrelid = 'public.profissionais'::regclass;
        `)
        console.log('Constraints on profissionais:', res.rows)
    } finally {
        await client.end()
    }
}

run().catch(err => {
    console.error('Error:', err.message)
    process.exit(1)
})
