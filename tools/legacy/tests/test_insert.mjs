const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co'
const serviceKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'

async function testInsert() {
    console.log('Testing manual insert into profissionais...')
    const res = await fetch(`${supabaseUrl}/rest/v1/profissionais`, {
        method: 'POST',
        headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        body: JSON.stringify({
            id: '00000000-0000-0000-0000-000000000002',
            email: 'manual-test@tvgflow.com',
            nome: 'Manual Test',
            role: 'staff',
            ativo: true
        })
    })
    
    const text = await res.text()
    console.log('Status:', res.status)
    console.log('Response:', text)
    
    if (res.ok) {
        // cleanup
        await fetch(`${supabaseUrl}/rest/v1/profissionais?id=eq.00000000-0000-0000-0000-000000000002`, {
            method: 'DELETE',
            headers: {
                'apikey': serviceKey,
                'Authorization': `Bearer ${serviceKey}`
            }
        })
    }
}

testInsert()
