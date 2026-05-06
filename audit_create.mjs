const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co'
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'

async function check() {
    const res = await fetch(`${supabaseUrl}/functions/v1/create-professional`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            nome: "Lorrano Gontijo",
            email: "lorranegontijo@tvgflow.com",
            ativo: true
        })
    });
    const text = await res.text();
    console.log('Status:', res.status);
    console.log('Response:', text);
}

check()
