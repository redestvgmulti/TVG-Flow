const fetch = require('node-fetch');
const dotenv = require('dotenv');
dotenv.config({ path: '/Users/geovanepanini/Dev/FlowOS/.env.local' });

async function test() {
  const url = `${process.env.VITE_SUPABASE_URL}/functions/v1/ap-employee-generator`;
  
  const payload = {
      empresa_id: "cd287e6e-f273-4d0f-a72d-2a8c391e40e9",
      titulo: "",
      conteudo: "",
      url_original: "https://g1.globo.com/mundo/noticia/2024/09/28/quem-era-hassan-nasrallah-lider-do-hezbollah.ghtml",
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
      
      try {
          const json = JSON.parse(text);
          console.log("Render URL mapped:", json.render_url);
          console.log("Caption mapped:", json.caption);
      } catch (e) {
          console.log("Not JSON");
      }
      
  } catch (err) {
      console.error(err);
  }
}
test();
