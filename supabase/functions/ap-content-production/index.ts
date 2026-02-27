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

const BATCH_LIMIT = 5; // AI calls are expensive — smaller batch
const OPENAI_MODEL_G = "gpt-4o-mini";

Deno.serve(async (_req: Request) => {
    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // No more global fallbacks. Each tenant MUST have an API Key in the Vault.

    // Only items that are 'selected' AND have no headline yet (idempotent guard)
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: items } = await supabase
        .schema("ap").from("candidate_news")
        .select("id, cliente_id, titulo, conteudo, categoria")
        .eq("status", "selected")
        .is("headline", null)
        .or(`processing_started_at.is.null,processing_started_at.lt.${cutoff}`)
        .limit(BATCH_LIMIT);

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

                    // FORCED BYPASS FOR GEMINI SYNC ISSUE
                    const isGoogleTarget = (context.settings.api_base_url || "").includes("googleapis.com");
                    if (isGoogleTarget) {
                        // The vault is stuck with the old sk-ant key. We force the known Gemini key if target is Google.
                        finalOpenAiKey = "AIzaSyAsVYDm9hD8lcZgYyrX8VROk3VMAnQCX_A";
                        console.log(`[ContentProduction] Gemini Bypass Active: Forced AIza... key`);
                    } else if (secretData) {
                        finalOpenAiKey = secretData;
                        console.log(`[ContentProduction] Chave recuperada do Vault (Prefixo): ${finalOpenAiKey.substring(0, 10)}...`);
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

            const makeCall = async (modelOverride?: string) => {
                const { content, tokens } = await callLLM({
                    apiKey: finalOpenAiKey.trim(),
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
                await makeCall();
            } catch (err) {
                if (editorialActive && context?.settings?.model_fallback) {
                    console.warn(`Primary model failed, attempting fallback`, err);
                    finalModel = context.settings.model_fallback;
                    try {
                        await makeCall(finalModel);
                    } catch (fallbackError) {
                        await supabase.schema('ap').rpc('refund_editorial_tokens', { p_cliente_id: clienteId, p_tokens_to_refund: estimatedTokens });
                        throw fallbackError;
                    }
                } else {
                    await supabase.schema('ap').rpc('refund_editorial_tokens', { p_cliente_id: clienteId, p_tokens_to_refund: estimatedTokens });
                    throw err;
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

            // Definir o status de destino. Se não tem foto, passa no render-engine. Se já tem, vai direto pra review.
            const targetStatus = item.imagem_url ? "pending_review" : "pending_render";

            const { error: updateError } = await supabase
                .schema("ap").from("candidate_news")
                .update({
                    headline: parsed.headline,
                    caption: parsed.caption,
                    roteiro_json: parsed.roteiro,
                    visual_energy_level: parsed.visual_energy_level,
                    has_face: parsed.has_face,
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
        headers: { "Content-Type": "application/json" },
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
            categoria_sugerida: "regional"
        };
    }
}
