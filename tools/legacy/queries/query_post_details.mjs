import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co';
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'; // Service Role Key

const supabase = createClient(supabaseUrl, supabaseKey, { db: { schema: 'ap' } });

async function run() {
  const { data, error } = await supabase
    .from('candidate_news')
    .select('*')
    .eq('id', 'ee201319-3294-49cf-badc-b783753be4ec')
    .single();

  if (error) {
    console.error('Error fetching data:', error);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

run();
