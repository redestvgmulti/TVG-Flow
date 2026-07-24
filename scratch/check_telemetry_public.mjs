import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local.bak' })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkTelemetryPublic() {
  console.log('Checking worker_telemetry in public schema...')
  const { data, error } = await supabase
    .from('worker_telemetry')
    .select('*')
    .eq('worker_name', 'ap-render-engine')
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) {
    console.error(error)
    return
  }

  console.table(data.map(log => ({
    id: log.id,
    news_id: log.news_id?.slice(0, 8),
    status: log.status,
    template: log.metadata?.template_id?.slice(0, 8)
  })))
}

checkTelemetryPublic()
