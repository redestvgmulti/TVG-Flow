const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co'
const serviceKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'

async function checkRLS() {
    // We can check if we can see the record with an ANON key (to simulate frontend without admin token if it's leaked)
    // But let's check the migration file for RLS policies on profissionais.
}

// Just list all professionals using the same service key to see if they are all there
async function listAll() {
    const res = await fetch(`${supabaseUrl}/rest/v1/profissionais?select=*`, {
        method: 'GET',
        headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`
        }
    })
    const data = await res.json()
    console.log('Total professionals:', data.length)
    console.log('Lorrane found:', data.some(p => p.email === 'lorranegontijo@tvgflow.com'))
}

listAll()
