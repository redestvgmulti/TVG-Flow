import { createClient } from '@supabase/supabase-js';
const url = 'https://gyooxmpyxncrezjiljrj.supabase.co/functions/v1/';
const key = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN';

const sb = createClient('https://gyooxmpyxncrezjiljrj.supabase.co', key);

async function trigger(fn) {
    console.log('Triggering', fn, '...');
    const res = await fetch(url + fn, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + key }
    });
    if (!res.ok) {
        const t = await res.text();
        console.log(fn, 'Error:', res.status, t);
    } else {
        const t = await res.text();
        console.log(fn, 'Success!', t);
    }
}

async function run() {
    console.log('Limpando ap.candidate_news...');
    const { error } = await sb.schema('ap').from('candidate_news').delete().eq('cliente_id', 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9');
    if (error) {
        console.error('Erro ao deletar:', error);
        return;
    }
    console.log('Banco de dados do painel limpo com sucesso.');

    await trigger('ap-data-ingestion');
    await new Promise(r => setTimeout(r, 4000));
    await trigger('ap-image-fetcher');
    await new Promise(r => setTimeout(r, 4000));
    await trigger('ap-scoring-engine');
    await new Promise(r => setTimeout(r, 4000));
    await trigger('ap-daily-feed-builder');
    await new Promise(r => setTimeout(r, 4000));
    await trigger('ap-content-production');
    console.log('Pipeline finished.');
}
run();
