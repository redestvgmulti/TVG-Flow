import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co';
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN';

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixPost() {
  const { data, error } = await supabase
    .schema('ap')
    .from('candidate_news')
    .update({ status: 'ready_to_publish', error_log: null })
    .eq('id', 'ee201319-3294-49cf-badc-b783753be4ec');

  if (error) {
    console.error('Error fixing post:', error);
  } else {
    console.log('Post fixed to ready_to_publish');
  }
}

fixPost();
