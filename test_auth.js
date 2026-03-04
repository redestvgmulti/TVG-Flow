import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'administracao@tvgflow.com',
    password: 'Adm@2026@'
  });
  if (error) { console.error('Auth Error:', error); return; }
  const jwt = data.session.access_token;
  
  const { data: invokeData, error: invokeErr } = await supabase.functions.invoke('ap-content-production', {
    body: { action: 'process_selected', newsId: 'c3bb3748-6fa0-4d95-af1b-f09f9f2f271d' },
    headers: { Authorization: `Bearer ${jwt}` }
  });
  
  console.log('Invoke Data:', JSON.stringify(invokeData, null, 2));
  console.log('Invoke Error:', invokeErr);
}
run();
