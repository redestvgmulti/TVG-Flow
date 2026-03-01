import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/geovanepanini/Dev/FlowOS/.env.local' });

async function test() {
  const url = `${process.env.VITE_SUPABASE_URL}/functions/v1/ap-employee-generator`;
  
  const payload = {
      empresa_id: "cd287e6e-f273-4d0f-a72d-2a8c391e40e9",
      titulo: "Notícia de teste do funcionário",
      conteudo: "Teste de geração manual com JSON válido forçado pelo back-end.",
      url_original: "",
      imagem_url: ""
    };
    
  console.log("Calling Edge function...", url);
  try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(payload)
      });
      console.log("Status:", res.status);
      const text = await res.text();
      console.log("Body:", text);
  } catch (err) {
      console.error(err);
  }
}
test();
