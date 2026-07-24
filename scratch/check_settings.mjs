import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local.bak' })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const CLIENT_ID = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'

async function checkSettings() {
  console.log('Checking editorial settings for client:', CLIENT_ID)
  const { data: settings, error: sErr } = await supabase
    .schema('ap')
    .from('editorial_settings')
    .select('*')
    .eq('cliente_id', CLIENT_ID)
    .single()

  if (sErr) console.error('Error fetching settings:', sErr)
  else console.log('Settings:', settings)

  console.log('\nChecking active templates...')
  const { data: templates, error: tErr } = await supabase
    .schema('ap')
    .from('templates')
    .select('*')
    .eq('empresa_id', CLIENT_ID)
    .eq('ativo', true)

  if (tErr) console.error('Error fetching templates:', tErr)
  else console.table(templates.map(t => ({ id: t.id.slice(0,8), nome: t.nome, uuid: t.placid_template_uuid, tipo: t.tipo })))
}

checkSettings()
