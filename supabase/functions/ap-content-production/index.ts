// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Camada 7: Content Production Worker
// Gera headline, caption e roteiro_json via OpenAI GPT-4o-mini.
// Triggered by: pg_cron (every 20 min)
// verify_jwt: false
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildEditorialPrompt, getEditorialContext } from "../_shared/editorialPromptBuilder.ts";
import { callLLM } from "../_shared/llmClient.ts";

const BATCH_LIMIT = 25; // Aumentado para lidar o gargalo
const OPENAI_MODEL_G = "gpt-4o-mini";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // No more global fallbacks. Each tenant MUST have an API Key in the Vault.

    // Optional targeted processing when invoked manualy (e.g. matéria manual)
    let targetNewsId: string | null = null;
    try {
        if (req.method === "POST") {
            const contentType = req.headers.get("Content-Type") || "";
            if (contentType.includes("application/json")) {
                const body = await req.json().catch(() => null);
                if (body && body.action === "process_selected" && typeof body.newsId === "string") {
                    targetNewsId = body.newsId;
                }
            }
        }
    } catch (e) {
        console.error("[ap-content-production] Failed to parse request body:", e);
    }

    // Only items that are 'selected' AND have no headline yet (idempotent guard)
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    let query = supabase
        .schema("ap").from("candidate_news")
        .select("id, cliente_id, titulo, conteudo, categoria, context_tag")
        .eq("status", "selected")
        .is("headline", null);

    if (targetNewsId) {
        // Execução dirigida para uma notícia específica (ex: matéria manual).
        query = query.eq("id", targetNewsId);
    } else {
        // Execução em lote via cron.
        query = query
            .or(`processing_started_at.is.null,processing_started_at.lt.${cutoff}`)
            .limit(BATCH_LIMIT);
    }

    const { data: items } = await query;

    const errors: any[] = [];
    for (const item of items ?? []) {
        // Lock
        const { data: updatedData, error: updateErr } = await supabase
            .schema("ap").from("candidate_news")
            .update({ processing_started_at: new Date().toISOString() })
            .eq("id", item.id)
            .eq("status", "selected")
            .select("id");

        if (updateErr || !updatedData || updatedData.length === 0) continue;

        try {
            // Who owns this news? To find the tenant settings
            let clienteId = item.cliente_id;

            let finalOpenAiKey = "";
            let finalModel = OPENAI_MODEL_G;
            let prompt = "";
            let editorialActive = false;
            let context = null;

            if (clienteId) {
                context = await getEditorialContext(supabase, clienteId, item.conteudo || item.titulo || "");
                if (context && context.settings && context.settings.vault_secret_id) {
                    editorialActive = true;
                    const { data: secretData } = await supabase.rpc('get_decrypted_secret', { secret_id: context.settings.vault_secret_id });

                    if (secretData) {
                        finalOpenAiKey = secretData;
                        console.log(`[ContentProduction] Chave recuperada do Vault (Prefixo): ${finalOpenAiKey.substring(0, 10)}...`);
                    } else {
                        console.warn(`[ContentProduction] Chave nao recuperada do Vault para ID: ${context.settings.vault_secret_id}`);
                    }
                }
            }

            if (!finalOpenAiKey) {
                // Fallback para variáveis de ambiente globais se o Vault não estiver configurado
                finalOpenAiKey = Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("OPENAI_API_KEY") || "";
            }

            if (!finalOpenAiKey) {
                throw new Error("Tenant " + clienteId + " tem chave Vault vazia e as variáveis globais ANTHROPIC_API_KEY/OPENAI_API_KEY também estão ausentes no Supabase.");
            }

            // Always use Editorial Builder now that legacy is dead
            prompt = await buildEditorialPrompt(supabase, {
                titulo: item.titulo,
                conteudo: item.conteudo,
                categoria: item.categoria,
                settings: context?.settings || {},
                promptVersion: context?.promptVersion,
                humanization: context?.humanization,
                rules: context?.rules || [],
                ragContext: context?.ragContext || [],
                openaiKey: finalOpenAiKey
            });
            finalModel = context?.settings?.model_primary || OPENAI_MODEL_G;

            // Reserve tokens
            const estimatedTokens = 1500;
            const { data: reserved, error: reserveErr } = await supabase.schema('ap').rpc('reserve_editorial_tokens', {
                p_cliente_id: clienteId,
                p_tokens: estimatedTokens
            });

            if (reserveErr || !reserved) {
                throw new Error("Tenant reached monthly token limit.");
            }

            let aiResponse = "";
            let apiTokens = 0;
            let completionTokens = 0;
            let promptTokens = 0;

            const baseUrl = context?.settings?.api_base_url || "https://api.openai.com/v1";
            const temperature = editorialActive && context?.settings ? context.settings.temperature : 0.7;
            const maxTokens = 400;

            // Tier 1: Client Key. Tier 2: Global FlowOS / TVG Key
            const hasGoodGlobalKey = Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("OPENAI_API_KEY") || "";

            const makeCall = async (modelOverride?: string, useGlobalKey: boolean = false) => {
                const effectiveKey = useGlobalKey ? hasGoodGlobalKey : finalOpenAiKey.trim();
                if (!effectiveKey) throw new Error("Nenhuma chave válida encontrada neste nível (Tier).");

                const { content, tokens } = await callLLM({
                    apiKey: effectiveKey,
                    baseUrl,
                    model: (modelOverride || finalModel),
                    prompt,
                    temperature,
                    maxTokens
                });
                aiResponse = content;
                apiTokens = tokens.total;
                promptTokens = tokens.prompt;
                completionTokens = tokens.completion;
            };

            try {
                // Tenta usar a chave do cliente primeiro
                await makeCall();
            } catch (err: any) {
                console.warn(`[ContentProduction] Tier 1 failed for item ${item.id}:`, err.message);

                let successOnFallback = false;

                // Se a falha foi 401/400 (Erro de Chave) e temos a Chave Mestra Global, ativamos a "Rede de Segurança" (Tier 2/3)
                const isAuthError = err.message.includes("401") || err.message.includes("400") || err.message.includes("chave");
                if (isAuthError && hasGoodGlobalKey) {
                    console.log(`[ContentProduction] Falling back to Tier 2 (Global Keys) for item ${item.id}`);
                    try {
                        await makeCall(undefined, true); // Usa a chave global com o mesmo modelo
                        successOnFallback = true;
                    } catch (globalFallbackErr) {
                        console.error(`[ContentProduction] Tier 2 Global Key ALSO failed`, globalFallbackErr);
                    }
                }

                // Se a chave não era o problema ou ela também falhou, tentamos fazer a fallback lateral (Falllback de Modelo)
                if (!successOnFallback) {
                    if (editorialActive && context?.settings?.model_fallback) {
                        console.warn(`[ContentProduction] Attempting Model Fallback to ${context.settings.model_fallback}`);
                        finalModel = context.settings.model_fallback;
                        try {
                            await makeCall(finalModel, hasGoodGlobalKey ? true : false); // Tenta o modelo menor usando a chave que estiver viva
                        } catch (fallbackError) {
                            await supabase.schema('ap').rpc('refund_editorial_tokens', { p_cliente_id: clienteId, p_tokens_to_refund: estimatedTokens });
                            throw fallbackError;
                        }
                    } else {
                        await supabase.schema('ap').rpc('refund_editorial_tokens', { p_cliente_id: clienteId, p_tokens_to_refund: estimatedTokens });
                        throw err; // Nenhuma salvação possível, falha dura.
                    }
                }
            }

            const parsed = parseAiOutput(aiResponse);

            // Refund unused tokens
            const tokensToRefund = estimatedTokens - apiTokens;
            if (tokensToRefund > 0) {
                await supabase.schema('ap').rpc('refund_editorial_tokens', { p_cliente_id: clienteId, p_tokens_to_refund: tokensToRefund });
            }

            // Log Editorial usage
            if (editorialActive && clienteId) {
                await supabase.schema("ap").from("editorial_logs").insert({
                    cliente_id: clienteId,
                    input_tokens: promptTokens,
                    output_tokens: completionTokens,
                    model: finalModel,
                    prompt_snapshot: prompt
                });
            }

            // Forçar TODAS as matérias para pending_render.
            // Isso garante que mesmo o upload manual de foto na "Nova Matéria" 
            // receba o logo e a moldura do Placid como as demais.
            const targetStatus = "pending_render";

            const { error: updateError } = await supabase
                .schema("ap").from("candidate_news")
                .update({
                    headline: parsed.headline,
                    caption: parsed.caption,
                    roteiro_json: parsed.roteiro,
                    visual_energy_level: parsed.visual_energy_level,
                    has_face: parsed.has_face,
                    context_tag: item.context_tag ? item.context_tag : parsed.context_tag,
                    categoria: item.categoria || parsed.categoria_sugerida,
                    status: targetStatus,
                    processing_started_at: null,
                })
                .eq("id", item.id)
                .eq("status", "selected");

            if (updateError) {
                throw new Error(`DB Update falhou para ${item.id}: ${updateError.message}`);
            }
        } catch (err: any) {
            console.error(`[ap-content-production] item ${item.id}:`, err);
            errors.push({ id: item.id, error: err.message || JSON.stringify(err) });
            await supabase
                .schema("ap").from("candidate_news")
                .update({ processing_started_at: null })
                .eq("id", item.id);
        }
    }

    return new Response(JSON.stringify({ ok: true, processed: items?.length ?? 0, errors }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
});

function parseAiOutput(raw: string) {
    try {
        const cleanedRaw = raw.replace(/^```json/, "").replace(/```$/, "").trim();
        const parsed = JSON.parse(cleanedRaw);

        let cat = String(parsed.categoria_sugerida ?? "regional").toLowerCase().trim();
        const allowed = ["regional", "nacional_relevante", "engajamento_alto", "global_contextual"];
        if (!allowed.includes(cat)) {
            cat = "regional";
        }

        return {
            headline: String(parsed.headline ?? "").slice(0, 65),
            caption: String(parsed.caption ?? "").slice(0, 220),
            roteiro: Array.isArray(parsed.roteiro) ? parsed.roteiro : [],
            visual_energy_level: ["low", "medium", "high"].includes(parsed.visual_energy_level)
                ? parsed.visual_energy_level
                : "medium",
            has_face: Boolean(parsed.has_face),
            context_tag: String(parsed.context_tag ?? "").toUpperCase().slice(0, 20),
            categoria_sugerida: cat
        };
    } catch (err) {
        console.error("[parseAiOutput] Failed to parse AI response", err, raw);
        return {
            headline: "",
            caption: "",
            roteiro: [],
            visual_energy_level: "medium",
            has_face: false,
            context_tag: null,
            categoria_sugerida: "regional"
        };
    }
}
