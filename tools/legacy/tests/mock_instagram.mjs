import { createClient } from '@supabase/supabase-js';

const sb = createClient('https://gyooxmpyxncrezjiljrj.supabase.co', 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN');

async function mock() {
  const { data: items } = await sb.schema('ap').from('candidate_news').select('id').in('status', ['selected', 'raw']).limit(2);
  
  if (items && items.length > 0) {
    for (const item of items) {
      await sb.schema('ap').from('candidate_news').update({
        status: 'pending_review',
        headline: '🚨 NOTÍCIA URGENTE: O que você precisa saber hoje!',
        caption: 'Acompanhe as últimas novidades e fique por dentro de tudo que está acontecendo. Deixe seu comentário abaixo! 👇\n\n#Noticias #Atualizacao #FiquePorDentro',
        render_url: 'https://images.unsplash.com/photo-1572949645841-094f3a9c4c94?q=80&w=600&auto=format&fit=crop',
        categoria: 'Atualidades',
        visual_energy_level: 'high'
      }).eq('id', item.id);
      console.log('Mocked item', item.id);
    }
  } else {
    console.log('No items found');
  }
}
mock();
