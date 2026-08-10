const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co'
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'

async function run() {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
        method: 'POST',
        headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            type: 'invite',
            email: 'lorranegontijo@tvgflow.com',
            data: { nome: 'Lorrano Gontijo' }
        })
    });
    
    if (!res.ok) {
        console.error("Error generateLink without data:", await res.text());
    } else {
        const data = await res.json();
        console.log("Success generateLink without data:", data);
    }
}

run();
