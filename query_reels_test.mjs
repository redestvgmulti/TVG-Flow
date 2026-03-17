import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co';
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'; // Service Role Key

const supabase = createClient(supabaseUrl, supabaseKey, { db: { schema: 'ap' } });

async function run() {
  const { data, error } = await supabase
    .from('candidate_news')
    .select('id, titulo, status, content_type, origin, error_log, created_at, processing_started_at, completed_at, media_status, rendered_at')
    .eq('content_type', 'reels')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('Error fetching data:', error);
  } else {
    data.forEach(x => console.log(`[${x.created_at}] ${x.titulo} | ID: ${x.id}\n  Status: ${x.status}\n  Origin: ${x.origin}\n  Media Status: ${x.media_status}\n  Error: ${x.error_log}\n`));
  }
}

run();
