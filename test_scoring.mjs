import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co';
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('Invoking ap-scoring-engine...');
    const { data, error } = await supabase.functions.invoke('ap-scoring-engine', {
        method: 'POST'
    });
    console.log('Response:', data);
    if (error) console.error('Error:', error);
}
run();
