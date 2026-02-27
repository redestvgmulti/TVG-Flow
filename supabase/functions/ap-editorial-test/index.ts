// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Motor Editorial: Test Endpoint & Token Limit Control
// verify_jwt: true
// Execute full pipeline and checks limits
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildEditorialPrompt, getEditorialContext } from "../_shared/editorialPromptBuilder.ts";
import { callLLM } from "../_shared/llmClient.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) throw new Error("Missing Authorization header");

        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
        const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: authHeader } },
        });

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) throw new Error("Unauthorized");

        let clienteId = null;
        const { data: profData } = await supabase
            .from("cliente_profissionais")
            .select("cliente_id")
            .eq("profissional_id", user.id)
            .eq("ativo", true)
            .limit(1)
            .maybeSingle();

        if (!profData) throw new Error("User has no active tenant");
        clienteId = profData.cliente_id;

        const sbAdmin = createClient(supabaseUrl, supabaseServiceRole);

        // 1. Resolve Secret (API Key) from Vault ONLY
        // Load Settings to find vault secret ID
        const context = await getEditorialContext(sbAdmin, clienteId, "");
        if (!context || !context.settings) {
            throw new Error("Editorial Settings not configured.");
        }

        const vaultId = context.settings.vault_secret_id;
        if (!vaultId) throw new Error("OpenAI Key not saved in Vault.");

        const { data: secretData, error: secretErr } = await sbAdmin.rpc('get_decrypted_secret', { secret_id: vaultId });
        if (secretErr || !secretData) {
            console.error("RPC get_decrypted_secret err", secretErr);
            throw new Error("Could not retrieve OpenAI key (Vault RPC failed or not configured)");
        }
        let openaiKey = secretData;

        // Limits check has been moved down

        // 3. Build Prompt
        const { titulo, conteudo, categoria } = await req.json();

        const finalPrompt = await buildEditorialPrompt(sbAdmin, {
            titulo,
            conteudo,
            categoria,
            settings: context.settings,
            promptVersion: context.promptVersion,
            humanization: context.humanization,
            rules: context.rules,
            ragContext: context.ragContext,
            openaiKey
        });

        // 4. Chamada à IA via adapter unificado (com fallback de modelo)
        let model = context.settings.model_primary || "gpt-4o-mini";
        const fallbackModel = context.settings.model_fallback || "gpt-4o";

        const baseUrl = context.settings.api_base_url || "https://api.openai.com/v1";

        // Reserve tokens before calling (Atomic pre-reservation to fix race conditions)
        const estimatedTokens = 1500;
        const { data: reserved, error: reserveErr } = await sbAdmin.rpc('reserve_editorial_tokens', {
            p_cliente_id: clienteId,
            p_tokens: estimatedTokens
        });

        if (reserveErr || !reserved) {
            throw new Error("Tenant reached monthly token limit.");
        }

        let llmContent = "";
        let totalTokens = 0;
        let promptTokens = 0;
        let completionTokens = 0;

        const temperature = context.settings.temperature ?? 0.7;
        const maxTokens = context.settings.max_tokens ?? 400;

        try {
            const { content, tokens } = await callLLM({
                apiKey: openaiKey,
                baseUrl,
                model,
                prompt: finalPrompt,
                temperature,
                maxTokens
            });
            llmContent = content;
            totalTokens = tokens.total;
            promptTokens = tokens.prompt;
            completionTokens = tokens.completion;
        } catch (e) {
            console.warn(`[ap-editorial-test] Primary model ${model} failed, attempting fallback to ${fallbackModel}`, e);
            model = fallbackModel;
            try {
                const { content, tokens } = await callLLM({
                    apiKey: openaiKey,
                    baseUrl,
                    model,
                    prompt: finalPrompt,
                    temperature,
                    maxTokens
                });
                llmContent = content;
                totalTokens = tokens.total;
                promptTokens = tokens.prompt;
                completionTokens = tokens.completion;
            } catch (fallbackError) {
                await sbAdmin.rpc('refund_editorial_tokens', { p_cliente_id: clienteId, p_tokens_to_refund: estimatedTokens });
                throw fallbackError;
            }
        }

        // Refund unused reserved tokens
        const tokensToRefund = estimatedTokens - totalTokens;
        if (tokensToRefund > 0) {
            await sbAdmin.rpc('refund_editorial_tokens', {
                p_cliente_id: clienteId,
                p_tokens_to_refund: tokensToRefund
            });
        }

        const { data: logInsert } = await sbAdmin.schema("ap").from("editorial_logs").insert({
            cliente_id: clienteId,
            input_tokens: promptTokens,
            output_tokens: completionTokens,
            model: model,
            prompt_snapshot: finalPrompt // Audit compliance
        }).select("id").single();

        const logId = logInsert?.id ?? null;

        let parsed: any;
        try {
            parsed = JSON.parse(llmContent || "{}");
        } catch {
            parsed = { raw: llmContent };
        }

        return new Response(
            JSON.stringify({
                parsed,
                tokens: totalTokens,
                tokens_detail: {
                    total: totalTokens,
                    prompt: promptTokens,
                    completion: completionTokens
                },
                model,
                log_id: logId
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (err: any) {
        console.error("Test Endpoint Err:", err);
        return new Response(JSON.stringify({ error: err.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
