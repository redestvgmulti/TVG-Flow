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
            SELECT column_name, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'profissionais';
        `)
        console.log('Columns in profissionais:', res.rows)
    } finally {
        await client.end()
    }
}

run().catch(err => {
    console.error('Error:', err.message)
    process.exit(1)
})
