const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co';
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'; // Service Role Key

async function simulateConcurrentCalls(count = 10) {
  const empresaId = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'; // TVG Multi
  console.log(`Simulating ${count} concurrent calls using REST to ap.get_and_advance_template...`);

  const promises = [];
  for (let i = 0; i < count; i++) {
    promises.push(
      fetch(`${supabaseUrl}/rest/v1/rpc/get_and_advance_template`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Accept-Profile': 'ap',
          'Content-Profile': 'ap'
        },
        body: JSON.stringify({
          p_empresa_id: empresaId,
          p_tipo: 'feed',
          p_template_set: 'default'
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
    return `Call ${i+1}: ${res.data?.nome || 'N/A'}`;
  });

  console.log(formattedResults.join('\n'));
}

simulateConcurrentCalls();
