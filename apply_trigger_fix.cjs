const { Client } = require('pg')

const client = new Client({
    host: 'aws-0-sa-east-1.pooler.supabase.com',
    port: 5432,
    user: 'postgres.gyooxmpyxncrezjiljrj',
    password: 'G1eovane23*',
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
})

const fixTriggerSQL = `
CREATE OR REPLACE FUNCTION "public"."ensure_profissional_on_auth_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_nome TEXT;
BEGIN
  v_nome := COALESCE(
    NEW.raw_user_meta_data->>'nome',
    split_part(NEW.email, '@', 1),
    'Novo Profissional'
  );

  INSERT INTO profissionais (id, email, nome, role, ativo)
  VALUES (NEW.id, NEW.email, v_nome, 'staff', true)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;
`

async function run() {
    await client.connect()
    console.log('✅ Conectado ao banco de dados.')

    try {
        // Check current function body
        const check = await client.query(`
            SELECT prosrc FROM pg_proc 
            WHERE proname = 'ensure_profissional_on_auth_user' 
            AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        `)
        console.log('\n📋 Função atual no banco:\n', check.rows[0]?.prosrc)

        // Apply the fix
        await client.query(fixTriggerSQL)
        console.log('\n✅ Trigger corrigido com sucesso!')

        // Verify
        const verify = await client.query(`
            SELECT prosrc FROM pg_proc 
            WHERE proname = 'ensure_profissional_on_auth_user' 
            AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        `)
        console.log('\n📋 Função após correção:\n', verify.rows[0]?.prosrc)

    } finally {
        await client.end()
    }
}

run().catch(err => {
    console.error('❌ Erro:', err.message)
    process.exit(1)
})
