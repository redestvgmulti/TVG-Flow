import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co';
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN';
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function run() {
  const { data, error } = await supabase
    .schema('ap')
    .from('candidate_news')
    .select('status, cliente_id')
    .eq('cliente_id', 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9');
  
  if (error) {
    console.error(error);
    return;
  }
  
  const counts = {};
  for(const row of data) {
    counts[row.status] = (counts[row.status] || 0) + 1;
  }
  console.log("STATUS COUNTS:", counts);
}
run();
