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

    const fallbackOpenaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!fallbackOpenaiKey) {
        return new Response(JSON.stringify({ error: "No system fallback key configured" }), { status: 500 });
    }

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

            let prompt = "";
            let finalOpenAiKey = fallbackOpenaiKey;
            let finalModel = OPENAI_MODEL_G;

            let editorialActive = false;
            let context = null;

            if (clienteId) {
                context = await getEditorialContext(supabase, clienteId, "");
                if (context && context.settings) {
                    editorialActive = true;
                    // Vault Resolution
                    const vaultId = context.settings.vault_secret_id;
                    if (vaultId) {
                        const { data: secretData } = await supabase.rpc('get_decrypted_secret', { secret_id: vaultId });
                        if (secretData) finalOpenAiKey = secretData;
                    }
                    prompt = buildEditorialPrompt({
                        titulo: item.titulo,
                        conteudo: item.conteudo,
                        categoria: item.categoria,
                        settings: context.settings,
                        promptVersion: context.promptVersion,
                        humanization: context.humanization,
                        rules: context.rules,
                        ragContext: context.ragContext
                    });
                    finalModel = context.settings.model_primary || OPENAI_MODEL_G;
                }
            }

            // Fallback to legacy behavior
            if (!editorialActive) {
                prompt = buildLegacyPrompt(item.titulo, item.conteudo, item.categoria);
            }

            // Check Limits if Editorial
            let limits = null;
            if (editorialActive && clienteId) {
                 const { data: l } = await supabase.from("ap.editorial_limits").select("*").eq("cliente_id", clienteId).maybeSingle();
                 limits = l;
                 if (limits && limits.monthly_token_used >= limits.monthly_token_limit) {
                     // Failsafe: downgrade to pure fallback since limit reached, or throw
                     console.error(`Tenant ${clienteId} reached token limit. Using fallback.`);
                     prompt = buildLegacyPrompt(item.titulo, item.conteudo, item.categoria);
                     finalOpenAiKey = fallbackOpenaiKey;
                     finalModel = OPENAI_MODEL_G;
                     editorialActive = false; 
                 }
            }

            let aiResponse = "";
            let apiTokens = 0;
            let completionTokens = 0;
            let promptTokens = 0;

            const makeCall = async (modelOverride?: string) => {
                 const res = await callOpenAI(finalOpenAiKey, prompt, modelOverride || finalModel, editorialActive && context?.settings ? context.settings.temperature : 0.7);
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
                    await makeCall(finalModel);
                 } else {
                    throw err;
                 }
            }

            const parsed = parseAiOutput(aiResponse);

            // Log Editorial usage
            if (editorialActive && clienteId) {
                 await supabase.from("ap.editorial_logs").insert({
                    cliente_id: clienteId,
                    input_tokens: promptTokens,
                    output_tokens: completionTokens,
                    model: finalModel,
                    prompt_snapshot: prompt
                 });

                 if (limits) {
                     await supabase.from("ap.editorial_limits").update({
                         monthly_token_used: limits.monthly_token_used + apiTokens
                     }).eq("id", limits.id);
                 }
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

function buildLegacyPrompt(titulo: string, conteudo: string | null, categoria: string | null): string {
    return `Você é um editor de notícias para redes sociais. Gere um JSON com os seguintes campos:
- headline: título impactante entre 50-65 caracteres
- caption: legenda para Instagram (max 220 chars, informal, engajador)
- roteiro: array de 3 strings: [abertura, desenvolvimento, chamada_para_ação]
- visual_energy_level: "low" | "medium" | "high" com base na urgência da notícia
- has_face: true se a notícia provavelmente mostra um rosto em destaque

Notícia:
Título: ${titulo}
${conteudo ? `Conteúdo: ${conteudo.slice(0, 500)}` : ""}
Categoria: ${categoria ?? "geral"}

Responda APENAS com o JSON, sem markdown.`;
}

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
