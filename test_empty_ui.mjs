import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/geovanepanini/Dev/FlowOS/.env.local' });

async function test() {
  const url = `${process.env.VITE_SUPABASE_URL}/functions/v1/ap-employee-generator`;
  
  const payload = {
    empresa_id: "cd287e6e-f273-4d0f-a72d-2a8c391e40e9",
    titulo: "Teste de retorno UI",
    conteudo: "Guerra das operadoras no Brasil mexe com a bolsa",
    url_original: null,
    imagem_url: null,
    auth_user_id: "test-user-id"
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    console.log("Status:", res.status);
    console.log("Response JSON:", JSON.stringify(data, null, 2));

  } catch (e) {
    console.error("Test Error:", e);
  }
}
test();
