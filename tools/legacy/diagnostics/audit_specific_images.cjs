const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data, error } = await supabase
        .schema('ap')
        .from('candidate_news')
        .select('id, titulo, status, imagem_url, imagem_storage, url_original, source, created_at, content_type')
        .or('titulo.ilike.*Caixa bate R$ 1,5*,titulo.ilike.*CNU prorrogado*,titulo.ilike.*Patrimônio de Anápolis*') // Fixed syntax maybe? Or just use multiple queries
        .order('created_at', { ascending: false });

    if (error) {
        const { data: data2, error: error2 } = await supabase
            .schema('ap')
            .from('candidate_news')
            .select('id, titulo, status, imagem_url, imagem_storage, url_original, source, created_at, content_type')
            .ilike('titulo', '%Caixa bate R$ 1,5%');

        const { data: data3, error: error3 } = await supabase
            .schema('ap')
            .from('candidate_news')
            .select('id, titulo, status, imagem_url, imagem_storage, url_original, source, created_at, content_type')
            .ilike('titulo', '%CNU prorrogado%');

        const { data: data4, error: error4 } = await supabase
            .schema('ap')
            .from('candidate_news')
            .select('id, titulo, status, imagem_url, imagem_storage, url_original, source, created_at, content_type')
            .ilike('titulo', '%Patrimônio de Anápolis%');

        console.log(JSON.stringify([...(data2 || []), ...(data3 || []), ...(data4 || [])], null, 2));
    }
    else console.log(JSON.stringify(data, null, 2));
}

check();
