import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'

const envPath = '.env.local'
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath })
}

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

async function testQuery() {
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'administracao@tvgflow.com',
    password: 'Adm@2026@'
  })
  
  if (authError) {
    console.error("Login Error:", authError)
    return
  }
  
  console.log("Logged in as:", authData.user.id)
  
  const searchTerm = "Buriti"
  
  const { data: clients } = await supabase
    .from('empresas')
    .select('id, nome')
    .eq('empresa_tipo', 'operacional')
    .order('nome')
    
  const matchingClientIds = clients
    .filter(c => c.nome.toLowerCase().includes(searchTerm.toLowerCase()))
    .map(c => c.id)
    
  const conditions = [`titulo.ilike.%${searchTerm}%`]
  if (matchingClientIds.length > 0) {
      conditions.push(`cliente_id.in.(${matchingClientIds.join(',')})`)
      conditions.push(`empresa_id.in.(${matchingClientIds.join(',')})`)
  }
  
  const orString = conditions.join(',')
  console.log("-> PostgREST OR string:", orString)
  
  let tasksQuery = supabase
    .from('tarefas')
    .select('id, titulo, cliente_id, empresa_id', { count: 'exact' })
    .in('status', ['pendente'])
    
  const { data: tasks, error, count } = await tasksQuery
  
  if (error) {
    console.error("API Error:", error)
    return
  }
  
  console.log(`-> API returned ${tasks?.length || 0} tasks for Buriti. Total Count = ${count}`)
  
  if (tasks && tasks.length > 0) {
    console.log("-> First task title:", tasks[0].titulo)
  }
  
  const filtered = (tasks || []).filter(task => {
      const searchLower = searchTerm.toLowerCase()
      const matchTitle = (task.titulo || '').toLowerCase().includes(searchLower)
      const matchCompany = (task.empresas?.nome || '').toLowerCase().includes(searchLower)
      
      const matchesSearch = matchTitle || matchCompany
      return matchesSearch
  })
  
  console.log(`-> Frontend local filter returned ${filtered.length} tasks matching "${searchTerm}"`)
}

testQuery()
