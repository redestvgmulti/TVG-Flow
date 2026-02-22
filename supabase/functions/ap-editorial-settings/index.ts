// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Motor Editorial: Settings API
// GET: Fetch tenant settings + active prompt + humanization
// PUT: Update settings (API keys sent to Vault)
// verify_jwt: true
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "http://localhost:4173, https://flowos.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) throw new Error("Missing Authorization header");

        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
        const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!; // needed for vault

        // 1. Authenticate user
        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: authHeader } },
        });

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) throw new Error("Unauthorized");

        // 2. Resolve target Client ID
        // For admin multi-tenant: they only have 1 active company usually.
        let clienteId = null;
        let role = null;
        const { data: profData } = await supabase
            .from("cliente_profissionais")
            .select("cliente_id, role")
            .eq("profissional_id", user.id)
            .eq("ativo", true)
            .limit(1)
            .maybeSingle();

        if (!profData) throw new Error("User has no active tenant");
        clienteId = profData.cliente_id;
        role = profData.role;

        const sbAdmin = createClient(supabaseUrl, supabaseServiceRole);

        // ================= GET =================
        if (req.method === "GET") {
            // Settings
            const { data: settings } = await sbAdmin
                .from("ap.editorial_settings")
                .select("*")
                .eq("cliente_id", clienteId)
                .maybeSingle();

            // Humanization
            const { data: humanization } = await sbAdmin
                .from("ap.editorial_humanization")
                .select("*")
                .eq("cliente_id", clienteId)
                .maybeSingle();

            // Active Prompt
            const { data: prompt } = await sbAdmin
                .from("ap.editorial_prompt_versions")
                .select("*")
                .eq("cliente_id", clienteId)
                .eq("is_active", true)
                .maybeSingle();

            // Rules (so frontend doesn't need to query ap.* directly)
            const { data: rules } = await sbAdmin
                .from("ap.editorial_rules")
                .select("*")
                .eq("cliente_id", clienteId)
                .order("created_at", { ascending: true });

            // Has key?
            const has_key = !!(settings?.vault_secret_id);

            return new Response(
                JSON.stringify({
                    settings: { ...settings, vault_secret_id: undefined, has_api_key: has_key },
                    humanization,
                    active_prompt: prompt,
                    rules: rules ?? []
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ================= PUT =================
        if (req.method === "PUT") {
            if (role !== "admin") {
                throw new Error("Ação não autorizada. Apenas administradores podem modificar as configurações editoriais.");
            }

            const body = await req.json();
            const { settings, apiKey, humanization } = body;

            // Handle API Key (Vault)
            let finalSecretId = settings?.vault_secret_id; // existing

            if (apiKey && apiKey.startsWith("sk-")) {
                const secretName = `ap_openai_${clienteId}`;
                const secretDesc = `OpenAI API Key for Tenant ${clienteId}`;

                // Check if secret exists in vault
                const { data: existingSecret } = await sbAdmin.rpc("read_secret", {
                    secret_name: secretName,
                });

                if (existingSecret) {
                    // update isn't straightforward via rpc, best to delete and recreate or if they have the exact same token ignore.
                    // Instead of full Vault CRUD here since there's no native SDK, we can insert into vault.secrets via standard insert if role allows, but Vault prevents standard inserts.
                    // For Edge Function + Vault we must use Vault's HTTP RPC or functions.
                }

                // Temporary workaround since Vault RPC implementation requires knowing the exact vault extension commands
                // Because standard Supabase JS client doesn't expose `vault.secrets.insert`, we use raw postgres function or rely on user creating it.
                // NOTE: For now, if the user sends apiKey, we store it encrypted. If the project doesn't have vault, this will fail.
                // Assuming vault is enabled:
                const { data: newSecretId, error: vaultErr } = await sbAdmin.rpc('insert_secret', {
                    name: secretName,
                    secret: apiKey,
                    description: secretDesc
                });

                if (vaultErr) {
                    console.error("Vault error:", vaultErr)
                    // Fallback if rpc insert_secret does not exist: Save to settings directly if forced (not recommended, but vault setup can be tricky).
                    // The prompt said NEVER RAW KEY. So we will fail if vault doesn't work.
                    throw new Error("Failed to store API Key securely in Vault. Ensure 'insert_secret' RPC exists.");
                }
                finalSecretId = newSecretId;
            }

            // Upsert Settings
            if (settings) {
                const upsertPayload = {
                    cliente_id: clienteId,
                    model_primary: settings.model_primary || 'gpt-4o-mini',
                    model_fallback: settings.model_fallback || 'gpt-4o',
                    temperature: settings.temperature ?? 0.7,
                    max_tokens: settings.max_tokens ?? 400,
                    system_prompt_override: settings.system_prompt_override ?? false,
                    override_prompt_text: settings.override_prompt_text ?? null,
                };

                if (finalSecretId) {
                    upsertPayload.vault_secret_id = finalSecretId;
                }

                await sbAdmin
                    .from("ap.editorial_settings")
                    .upsert(upsertPayload, { onConflict: "cliente_id" });
            }

            // Upsert Humanization
            if (humanization) {
                await sbAdmin
                    .from("ap.editorial_humanization")
                    .upsert({
                        cliente_id: clienteId,
                        formality_level: humanization.formality_level ?? 50,
                        creativity_level: humanization.creativity_level ?? 50,
                        technical_level: humanization.technical_level ?? 30,
                        anti_ai_variation: humanization.anti_ai_variation ?? true
                    }, { onConflict: "cliente_id" });
            }

            return new Response(JSON.stringify({ success: true }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        return new Response("Method not allowed", { status: 405, headers: corsHeaders });

    } catch (err: any) {
        console.error("Settings Error:", err);
        return new Response(JSON.stringify({ error: err.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
