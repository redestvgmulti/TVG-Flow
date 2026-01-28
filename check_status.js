
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co'
const supabaseKey = 'sb_publishable_YujCW2VFOCxkMh1QRgwVtg_AXFd0qQ7'
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkStatus() {
  const { data, error } = await supabase
    .from('tarefas')
    .select('status')
  
  if (error) {
    console.error('Error:', error)
    return
  }

  const statuses = [...new Set(data.map(t => t.status))]
  console.log('Unique statuses:', statuses)
}

checkStatus()
