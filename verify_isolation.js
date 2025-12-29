
// ... existing code ...
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://gyooxmpyxncrezjiljrj.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5b294bXB5eG5jcmV6amlsanJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4MDE2MzUsImV4cCI6MjA4MTM3NzYzNX0.mn0Y66MZ6DHxdyMg2Oh6bSIi2CC5h8RmN5N4hlyqhog'
const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
    }
})

async function verifyIsolation() {
    // 1. Login
    const { data: { user }, error: loginError } = await supabase.auth.signInWithPassword({
        email: 'geovanepanini@agencyflow.com',
        password: 'G1eovane23*'
    })

    if (loginError) {
        console.error('Login Failed:', loginError.message)
        process.exit(1)
    }

    console.log('Login Successful inside script.')
    console.log('User ID:', user.id)

    // 2. Check for Company Links (Should be EMPTY)
    const { data: links, error: linkError } = await supabase
        .from('empresa_profissionais')
        .select('*')
        .eq('profissional_id', user.id)

    if (linkError) {
        console.error('Error querying links:', linkError.message)
        process.exit(1)
    }

    console.log('Company Links Found:', links.length)

    if (links.length === 0) {
        console.log('SUCCESS: User is isolated (0 company links).')
        process.exit(0)
    } else {
        console.error('FAILURE: User is linked to companies:', links)
        process.exit(1)
    }
}

verifyIsolation()
