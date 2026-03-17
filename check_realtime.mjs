import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co';
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'; // Service Role Key

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkRealtime() {
  const { data, error } = await supabase.rpc('get_realtime_status')
    
  if(error) {
    console.log("fallback...");
  }
}
checkRealtime();
