import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co';
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'; // Service Role Key

const supabase = createClient(supabaseUrl, supabaseKey, { db: { schema: 'ap' } });

async function run() {
  const { data, error } = await supabase
    .from('candidate_news')
    .update({ 
      status: 'pending_render',
      processing_started_at: null,
      error_log: null,
      retry_count: 0
    })
    .eq('id', 'ee201319-3294-49cf-badc-b783753be4ec')
    .select();

  if (error) {
    console.error('Error resetting status:', error);
  } else {
    console.log('Status reset successfully. It will be picked up by ap-render-engine on next cron cycle or trigger.');
    console.log(JSON.stringify(data, null, 2));
  }
}

run();
