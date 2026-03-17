import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co';
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'; // Service Role Key

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase
    .schema('ap')
    .from('candidate_news')
    .select('id, titulo, status, created_at, processing_started_at, rendered_at, error_log, retry_count, content_type')
    .ilike('titulo', '%teste3%')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('Error fetching data:', error);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

run();
