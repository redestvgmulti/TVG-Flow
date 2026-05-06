const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co'
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'

async function check() {
    const res = await fetch(`${supabaseUrl}/rest/v1/profissionais`, {
        method: 'POST',
        headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        body: JSON.stringify({
            id: '00000000-0000-0000-0000-000000000001',
            email: 'test@tvgflow.com',
            role: 'staff',
            ativo: true
        })
    });
    
    if (!res.ok) {
        console.error("Error inserting without nome:", await res.text());
    } else {
        const data = await res.json();
        console.log("Success:", data);
        
        // cleanup
        await fetch(`${supabaseUrl}/rest/v1/profissionais?id=eq.00000000-0000-0000-0000-000000000001`, {
            method: 'DELETE',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
            }
        });
    }
}

check();
