import { createClient } from '@supabase/supabase-js'
const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co';
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('Invoking ap-image-fetcher...');
    const { data, error } = await supabase.functions.invoke('ap-image-fetcher', {
        method: 'POST'
    });
    console.log('Response:', data);
    if (error) console.error('Error:', error);
}
run();
