import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co';
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN';

const supabase = createClient(supabaseUrl, supabaseKey);

async function simulateConcurrentCalls(count = 10) {
  const empresaId = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'; // TVG Multi
  console.log(`Simulating ${count} concurrent calls to ap.get_and_advance_template...`);

  const promises = [];
  for (let i = 0; i < count; i++) {
    // Note: rpc functions in other schemas need to be called via schema.rpc if supabase-js supports it
    // Actually, supabase-js v2 supports: supabase.rpc('fn_name', { args })
    // If it requires schema prefix, it's supabase.schema('ap').rpc(...)
    // Let's try .schema('ap').rpc() (undocumented but sometimes works), or just REST
    promises.push(
      supabase.schema('ap').rpc('get_and_advance_template', {
        p_empresa_id: empresaId,
        p_tipo: 'feed',
        p_template_set: 'default'
      })
    );
  }

  const results = await Promise.all(promises);
  
  const formattedResults = results.map((res, i) => {
    if (res.error) return `Call ${i+1}: Error - ${res.error.message}`;
    return `Call ${i+1}: ${res.data[0]?.nome || res.data?.nome || 'N/A'}`;
  });

  console.log(formattedResults.join('\n'));
}

simulateConcurrentCalls();
