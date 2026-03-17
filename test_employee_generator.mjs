const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co';
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'; // Service Role Key

async function createTestNews(count = 5) {
  const empresaId = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'; // TVG Multi
  console.log(`[TEST] Invoking ap-employee-generator ${count} times...`);

  const promises = [];
  for (let i = 0; i < count; i++) {
    promises.push(
      fetch(`${supabaseUrl}/functions/v1/ap-employee-generator`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          empresa_id: empresaId,
          titulo: `Teste Rotacao ${i+1} - ${Date.now()}`,
          conteudo: `Este é um conteúdo de teste automatizado para validar a rotação justa de templates na fila. Teste número ${i+1}.`,
          content_type: 'feed',
          template_set: 'default',
          imagem_url: 'https://via.placeholder.com/1080x1080.jpg',
          // NO placid_template_uuid (should trigger rotation)
        })
      }).then(async res => {
          if(!res.ok) {
              return { error: await res.text() };
          }
          return { data: await res.json() };
      })
    );
  }

  const results = await Promise.all(promises);
  
  const formattedResults = results.map((res, i) => {
    if (res.error) return `Call ${i+1}: Error - ${res.error}`;
    return `Call ${i+1}: Success, News ID: ${res.data?.news_id}, Status: ${res.data?.status}`;
  });

  console.log(formattedResults.join('\n'));
}

createTestNews();
