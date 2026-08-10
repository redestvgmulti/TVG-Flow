import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co';
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'; // Service Role Key

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAssignedTemplates() {
  const { data, error } = await supabase
    .schema('ap')
    .from('candidate_news')
    .select('id, titulo, template_nome_snapshot, created_at')
    .ilike('titulo', 'Teste Rotacao%')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error("Error:", error);
  } else {
    console.log("=== Templates Assigned to Test Posts ===");
    console.table(data.map(t => ({
      Post: t.titulo,
      Template: t.template_nome_snapshot,
      Criado: t.created_at
    })));
  }
}

checkAssignedTemplates();
