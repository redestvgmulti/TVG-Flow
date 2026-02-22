// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Camada 7: Content Production Worker
// Gera headline, caption e roteiro_json via OpenAI GPT-4o-mini.
// Triggered by: pg_cron (every 20 min)
// verify_jwt: false
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildEditorialPrompt, getEditorialContext } from "../_shared/editorialPromptBuilder.ts";

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
        .from("ap.candidate_news")
        .select("id, titulo, conteudo, categoria, topic_id")
        .eq("status", "selected")
        .is("headline", null)
        .or(`processing_started_at.is.null,processing_started_at.lt.${cutoff}`)
        .limit(BATCH_LIMIT);

    for (const item of items ?? []) {
        // Lock
        const { count } = await supabase
            .from("ap.candidate_news")
            .update({ processing_started_at: new Date().toISOString() })
            .eq("id", item.id)
            .eq("status", "selected")
            .select("id", { count: "exact", head: true });

        if (!count) continue;

        try {
            // Who owns this topic? To find the tenant settings
            let clienteId = null;
            if (item.topic_id) {
                const { data: topic } = await supabase.from('ap.topics').select('cliente_id').eq('id', item.topic_id).single();
                clienteId = topic?.cliente_id;
            }

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
                    }
                }
            }

            if (!finalOpenAiKey) {
                throw new Error("Tenant " + clienteId + " has no valid OpenAI API Key in Vault.");
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
            const { data: reserved, error: reserveErr } = await supabase.rpc('reserve_editorial_tokens', {
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

            const makeCall = async (modelOverride?: string) => {
                const res = await callOpenAI(finalOpenAiKey!, prompt, modelOverride || finalModel, editorialActive && context?.settings ? context.settings.temperature : 0.7);
                aiResponse = res.content;
                apiTokens = res.total_tokens;
                promptTokens = res.prompt_tokens;
                completionTokens = res.completion_tokens;
                return res;
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
                        await supabase.rpc('refund_editorial_tokens', { p_cliente_id: clienteId, p_tokens_to_refund: estimatedTokens });
                        throw fallbackError;
                    }
                } else {
                    await supabase.rpc('refund_editorial_tokens', { p_cliente_id: clienteId, p_tokens_to_refund: estimatedTokens });
                    throw err;
                }
            }

            const parsed = parseAiOutput(aiResponse);

            // Refund unused tokens
            const tokensToRefund = estimatedTokens - apiTokens;
            if (tokensToRefund > 0) {
                await supabase.rpc('refund_editorial_tokens', { p_cliente_id: clienteId, p_tokens_to_refund: tokensToRefund });
            }

            // Log Editorial usage
            if (editorialActive && clienteId) {
                await supabase.from("ap.editorial_logs").insert({
                    cliente_id: clienteId,
                    input_tokens: promptTokens,
                    output_tokens: completionTokens,
                    model: finalModel,
                    prompt_snapshot: prompt
                });
            }

            await supabase
                .from("ap.candidate_news")
                .update({
                    headline: parsed.headline,
                    caption: parsed.caption,
                    roteiro_json: parsed.roteiro,
                    visual_energy_level: parsed.visual_energy_level,
                    has_face: parsed.has_face,
                    status: "pending_render",
                    processing_started_at: null,
                })
                .eq("id", item.id)
                .eq("status", "selected");
        } catch (err) {
            console.error(`[ap-content-production] item ${item.id}:`, err);
            await supabase
                .from("ap.candidate_news")
                .update({ processing_started_at: null })
                .eq("id", item.id);
        }
    }

    return new Response(JSON.stringify({ ok: true, processed: items?.length ?? 0 }), {
        headers: { "Content-Type": "application/json" },
    });
});

// Removed legacy prompt builder to save space and rely on EditorialPromptBuilder baseline

async function callOpenAI(apiKey: string, prompt: string, model: string, temp: number) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model: model,
            messages: [{ role: "user", content: prompt }],
            temperature: temp,
            max_tokens: 400,
        }),
        signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) throw new Error(`OpenAI error: ${res.status}`);
    const data = await res.json();
    return {
        content: data.choices?.[0]?.message?.content ?? "",
        total_tokens: data.usage?.total_tokens ?? 0,
        prompt_tokens: data.usage?.prompt_tokens ?? 0,
        completion_tokens: data.usage?.completion_tokens ?? 0
    };
}

function parseAiOutput(raw: string) {
    try {
        const parsed = JSON.parse(raw.trim());
        return {
            headline: String(parsed.headline ?? "").slice(0, 65),
            caption: String(parsed.caption ?? "").slice(0, 220),
            roteiro: Array.isArray(parsed.roteiro) ? parsed.roteiro : [],
            visual_energy_level: ["low", "medium", "high"].includes(parsed.visual_energy_level)
                ? parsed.visual_energy_level
                : "medium",
            has_face: Boolean(parsed.has_face),
        };
    } catch {
        return { headline: "", caption: "", roteiro: [], visual_energy_level: "medium", has_face: false };
    }
}
