import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co';
const supabaseKey = 'sb_secret_QWRBuUsd4mpTFodU5CvFXg_ZqE7IgQN'; // Service Role Key

const supabase = createClient(supabaseUrl, supabaseKey);

async function auditRotation() {
  console.log("\n=== Current Template Queue State ===");
  const { data: templates, error: tError } = await supabase
    .schema('ap')
    .from('templates')
    .select('id, nome, ordem, ativo, tipo, template_set, ultima_vez_usado')
    .eq('ativo', true)
    .order('ordem', { ascending: true });

  if (tError) {
    console.error("Error fetching templates:", tError);
  } else {
    // Filter by whatever was normally used. Let's look at all active templates for now.
    console.log(`Total Active templates: ${templates.length}`);
    console.table(templates.map(t => ({
      Nome: t.nome,
      Ordem: t.ordem,
      Tipo: t.tipo,
      Set: t.template_set,
      "Ultimo Uso": t.ultima_vez_usado ? new Date(t.ultima_vez_usado).toISOString() : 'Nunca'
    })));
  }
}

auditRotation();
