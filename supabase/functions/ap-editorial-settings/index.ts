// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Motor Editorial: Settings API
// MODE: SINGLE-TENANT (TVG only)
// GET: Fetch settings + active prompt + humanization + rules
// PUT: Update settings (API keys sent to Vault)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { EditorialAdminAuthorizationError, requireEditorialAdmin } from "../_shared/editorialAdminAuth.ts";

const FIXED_CLIENT_ID = "cd287e6e-f273-4d0f-a72d-2a8c391e40e9";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const clienteId = FIXED_CLIENT_ID;

        const sbAdmin = createClient(supabaseUrl, supabaseServiceRole);
        await requireEditorialAdmin(req, sbAdmin, clienteId);

        // ============================================================
        // GET
        // ============================================================
        if (req.method === "GET") {
            const { data: settings } = await sbAdmin
                .schema("ap")
                .from("editorial_settings")
                .select("*")
                .eq("cliente_id", clienteId)
                .maybeSingle();

            const { data: humanization } = await sbAdmin
                .schema("ap")
                .from("editorial_humanization")
                .select("*")
                .eq("cliente_id", clienteId)
                .maybeSingle();

            const { data: prompt } = await sbAdmin
                .schema("ap")
                .from("editorial_prompt_versions")
                .select("*")
                .eq("cliente_id", clienteId)
                .eq("is_active", true)
                .maybeSingle();

            const { data: rules } = await sbAdmin
                .schema("ap")
                .from("editorial_rules")
                .select("*")
                .eq("cliente_id", clienteId)
                .order("created_at", { ascending: true });

            const has_key = !!settings?.vault_secret_id;

            return new Response(
                JSON.stringify({
                    settings: { ...settings, vault_secret_id: undefined, has_api_key: has_key },
                    humanization,
                    active_prompt: prompt,
                    rules: rules ?? [],
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ============================================================
        // PUT
        // ============================================================
        if (req.method === "PUT") {
            const body = await req.json();
            const { settings, apiKey, humanization } = body;

            // 1. Fetch current finalSecretId from DB if no new key is provided
            let finalSecretId = null;

            if (apiKey && apiKey.startsWith("sk-")) {
                const secretName = `ap_openai_platform`;
                const secretDesc = `OpenAI API Key - TVG Platform`;

                const { data: newSecretId, error: vaultErr } = await sbAdmin.rpc("insert_secret", {
                    name: secretName,
                    secret: apiKey,
                    description: secretDesc,
                });

                if (vaultErr) {
                    console.error("Vault error:", vaultErr);
                    return new Response(
                        JSON.stringify({ error: "Falha ao armazenar a chave no Vault: " + vaultErr.message }),
                        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                    );
                }
                finalSecretId = newSecretId;
            } else {
                // Manter o secret anterior caso exista
                const { data: existingSettings } = await sbAdmin
                    .schema("ap")
                    .from("editorial_settings")
                    .select("vault_secret_id")
                    .eq("cliente_id", clienteId)
                    .maybeSingle();
                if (existingSettings) {
                    finalSecretId = existingSettings.vault_secret_id;
                }
            }

            if (settings) {
                const upsertPayload = {
                    cliente_id: clienteId,
                    model_primary: settings.model_primary || "gpt-4o-mini",
                    model_fallback: settings.model_fallback || "gpt-4o",
                    temperature: settings.temperature ?? 0.7,
                    max_tokens: settings.max_tokens ?? 400,
                    system_prompt_override: settings.system_prompt_override ?? false,
                    override_prompt_text: settings.override_prompt_text ?? null,
                    api_base_url: settings.api_base_url ?? null,
                    vault_secret_id: finalSecretId,
                };

                const { error: settingsErr } = await sbAdmin
                    .schema("ap")
                    .from("editorial_settings")
                    .upsert(upsertPayload, { onConflict: "cliente_id" });

                if (settingsErr) console.error("Settings upsert error:", settingsErr);
            }

            if (humanization) {
                const { error: humErr } = await sbAdmin
                    .schema("ap")
                    .from("editorial_humanization")
                    .upsert(
                        {
                            cliente_id: clienteId,
                            formality_level: humanization.formality_level ?? 50,
                            creativity_level: humanization.creativity_level ?? 50,
                            technical_level: humanization.technical_level ?? 30,
                            anti_ai_variation: humanization.anti_ai_variation ?? true,
                        },
                        { onConflict: "cliente_id" }
                    );
                if (humErr) console.error("Humanization upsert error:", humErr);
            }

            return new Response(
                JSON.stringify({ success: true }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    } catch (err: any) {
        console.error("Settings Error:", err);
        return new Response(
            JSON.stringify({ error: err instanceof EditorialAdminAuthorizationError ? "EDITORIAL_ADMIN_REQUIRED" : err.message }),
            { status: err instanceof EditorialAdminAuthorizationError ? err.status : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
