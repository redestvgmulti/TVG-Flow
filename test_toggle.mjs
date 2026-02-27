import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://gyooxmpyxncrezjiljrj.supabase.co', 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN');

async function testToggle() {
    const url = 'https://gyooxmpyxncrezjiljrj.supabase.co/functions/v1/ap-data-ingestion';
    const headers = { 'Authorization': 'Bearer sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN' };

    console.log("1. Desligando o Motor (Pausa)...");
    await sb.schema('ap').from('system_config').upsert({ cliente_id: 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9', ingestion_enabled: false });

    console.log("2. Acionando a Ingestão em Nuvem...");
    const res1 = await fetch(url, { method: 'POST', headers });
    console.log("-> Resposta com Motor Pausado:", await res1.text());

    console.log("\\n3. Ligando o Motor (Ativo)...");
    await sb.schema('ap').from('system_config').upsert({ cliente_id: 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9', ingestion_enabled: true });

    console.log("4. Acionando a Ingestão em Nuvem...");
    const res2 = await fetch(url, { method: 'POST', headers });
    console.log("-> Resposta com Motor Ligado:", await res2.text());
}

testToggle();
