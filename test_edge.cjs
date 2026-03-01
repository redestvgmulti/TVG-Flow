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
      empresa_id: '1e194121-8727-4a7b-a01b-52c673ba7170',
      titulo: '',
      conteudo: '',
      url_original: 'https://g1.globo.com/mundo/noticia/2026/02/28/ira-anuncia-lider.ghtml',
      auth_user_id: 'teste-user'
    })
  });
  const text = await response.text();
  console.log('Status Base Endpoint:', response.status);
  console.log('Response Body:', text);
}
test();
