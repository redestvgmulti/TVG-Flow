import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co';
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'; // Service Role Key

const supabase = createClient(supabaseUrl, supabaseKey, { db: { schema: 'ap' } });

async function run() {
  const { data, error } = await supabase
    .from('candidate_news')
    .select('id, titulo, placid_template_uuid, template_nome_snapshot, content_type')
    .eq('id', 'ee201319-3294-49cf-badc-b783753be4ec');

  if (error) {
    console.error('Error fetching data:', error);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

run();
