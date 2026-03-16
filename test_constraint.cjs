const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co';
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN';
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data, error } = await supabase.rpc('get_constraint_def', { constraint_name: 'candidate_news_status_check' });
  
  if (error) {
    // try via raw query if RPC not available
    const { data: qData, error: qErr } = await supabase.from('candidate_news').select('status').limit(1);
    console.log("Error finding constraint, trying to fetch allowed constraints might be hard via REST API");
  } else {
    console.log("Data:", data);
  }
}

main();
