const dotenv = require('dotenv');
dotenv.config({ path: '/Users/geovanepanini/Dev/FlowOS/.env.local' });

async function test() {
    const response = await fetch(`${process.env.VITE_SUPABASE_URL}/functions/v1/ap-employee-generator`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            empresa_id: 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9',
            titulo: '',
            conteudo: '',
            url_original: 'https://g1.globo.com/mundo/noticia/2026/02/28/ira-anuncia-lider-test-' + Date.now() + '.ghtml',
            auth_user_id: 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'
        })
    });
    const text = await response.text();
    console.log('Status Base Endpoint:', response.status);
    console.log('Response Body:', text);
}
test();
