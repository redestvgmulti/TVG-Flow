import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local.bak' })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const CLIENT_ID = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'

async function inspectTemplate() {
  const { data: templates } = await supabase
    .schema('ap')
    .from('templates')
    .select('*')
    .eq('empresa_id', CLIENT_ID)
    .limit(1)

  console.log('Template Sample:', templates[0])
}

inspectTemplate()
