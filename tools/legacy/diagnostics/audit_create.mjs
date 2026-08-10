const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co'
const serviceKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'

async function check() {
    const res = await fetch(`${supabaseUrl}/functions/v1/create-professional`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            nome: "Lorrane Gontijo",
            email: "lorranegontijo@tvgflow.com",
            role: "profissional",
            ativo: true
        })
    });
    const text = await res.text();
    console.log('Status:', res.status);
    console.log('Response:', text);
}

check()
