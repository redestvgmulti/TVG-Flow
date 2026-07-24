import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local.bak' })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkErrors() {
  console.log('Checking for render errors...')
  const { data, error } = await supabase
    .schema('ap')
    .from('candidate_news')
    .select('id, headline, error_log, status, render_attempts')
    .not('error_log', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(5)

  if (error) {
    console.error(error)
    return
  }

  console.table(data.map(item => ({
    id: item.id.slice(0, 8),
    status: item.status,
    attempts: item.render_attempts,
    error: item.error_log?.slice(0, 100)
  })))
}

checkErrors()
