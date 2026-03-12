// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Camada 7: Content Production Worker
// Hybrid Editorial Engine: suporta userHeadline / userTag / userText
// Gera headline, caption e roteiro_json via LLM. A IA não sobrescreve dados do usuário.
// Triggered by: pg_cron (every 20 min) | verify_jwt: false
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildEditorialPrompt, getEditorialContext, buildStudioPrompt } from "../_shared/editorialPromptBuilder.ts";
import { callLLM } from "../_shared/llmClient.ts";

const BATCH_LIMIT = 50;
const OPENAI_MODEL_G = "gpt-4o-mini";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};

declare const Deno: any;

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    let actionType: string = "cron";
    let newsId: string | null = null;
    let userHeadline: string | null = null;
    let userTag: string | null = null;
    let userText: string | null = null;
    let body: any = {};

    try {
        if (req.method === "POST") {
            body = await req.json().catch(() => ({}));
            actionType = body.action || "cron";
            newsId = body.newsId || null;
            userHeadline = body.userHeadline || null;
            userTag = body.userTag || null;
            userText = body.userText || null;
        }
    } catch (e) {
        console.error("[ap-content-production] Error parsing request body:", e);
    }

    // Cron (automático): processa apenas 'raw' e 'ready_for_scoring'.
    // process_selected: gera texto mas mantém status 'selected' (editor ainda não aprovou).
    // approve_for_ig: aprovação humana explícita → move para 'pending_render'.
    let statusList = ["raw", "ready_for_scoring"];
    if (actionType === "process_selected" || actionType === "approve_for_ig" || actionType === "process_studio") {
        statusList = ["selected", "studio_selected", "pending_review"];
    }

    let query = supabase.schema("ap").from("candidate_news")
        .select("id, cliente_id, titulo, conteudo, categoria, context_tag, url_original, status, headline, caption, content_type");

    if (newsId) {
        query = query.eq("id", newsId);
    } else {
        query = query.in("status", statusList);
    }

    const { data: items, error: fetchError } = await query
        .or(`processing_started_at.is.null,processing_started_at.lt.${new Date(Date.now() - 10 * 60 * 1000).toISOString()}`)
        .limit(BATCH_LIMIT);

    if (fetchError) {
        return new Response(JSON.stringify({ error: fetchError.message }), { status: 500, headers: corsHeaders });
    }

    const errors: any[] = [];
    let processedCount = 0;
    let totalLocked = 0;

    for (const item of items ?? []) {
        // Lock
        const { data: locked, error: lockErr } = await supabase
            .schema("ap").from("candidate_news")
            .update({ processing_started_at: new Date().toISOString() })
            .eq("id", item.id)
            .is("processing_started_at", null)
            .select("id");

        if (lockErr || !locked || locked.length === 0) {
            continue;
        }
        totalLocked++;

        try {
            let clienteId = item.cliente_id;

            // --- LLM BYPASS (Human Sovereignty Safeguard) ---
            // Only bypass if the item was MANUALLY EDITED by an admin, NOT if it was created
            // by ap-employee-generator (which already has AI-generated content at creation time).
            // Employee-sourced items must still go through expansion here when being approved.
            const isEmployeeGenerated = item.source === "employee";
            const hasManualInput = (item.headline && item.headline.length > 5) || (item.caption && item.caption.length > 10);

            if (actionType === "approve_for_ig") {
                console.log(`[FLOW] Explicit human approval for ${item.id}. Moving directly to pending_render.`);
                const finalHeadline = userHeadline || item.headline || item.titulo || "Pauta OMNI";
                const finalCaption = userText || item.caption || "";
                if (item.content_type === "feed" && !item.imagem_url && !item.imagem_storage && !item.render_url) {
                    // Part 1 - Backend Guardrail
                    throw new Error("Feed posts require imagem_url before approval");
                }
                const finalTag = userTag || item.context_tag || item.categoria || "DESTAQUE";

                const updatePayload: any = {
                    headline: finalHeadline,
                    caption: finalCaption,
                    context_tag: finalTag,
                    status: "pending_render",
                    processing_started_at: null
                };

                if (typeof body?.approved_by_id === "string") {
                    updatePayload.approved_by = body.approved_by_id;
                    updatePayload.approved_by_name = body.approved_by_name || "Editor";
                    updatePayload.approved_at = new Date().toISOString();
                }

                await supabase.schema("ap").from("candidate_news")
                    .update(updatePayload)
                    .eq("id", item.id);

                if (typeof body?.approved_by_id === "string") {
                    await supabase.schema("ap").from("editorial_events").insert({
                        worker: "ap-content-production",
                        action: "approve_news",
                        news_id: item.id,
                        user_id: body.approved_by_id,
                        payload: updatePayload
                    });
                }

                processedCount++;
                continue;
            }

            if (hasManualInput && !isEmployeeGenerated && actionType !== "process_studio") {
                console.log(`[FLOW] [ap-content-production] Manual edit detected — item ${item.id} moved to pending_review (Action: ${actionType}). Awaiting human approval.`);
                await supabase.schema("ap").from("candidate_news")
                    .update({
                        status: "pending_review",  // Human must approve before render
                        processing_started_at: null
                    })
                    .eq("id", item.id)
                    .in("status", ["raw", "ready_for_scoring", "scored", "selected"]); // Race-condition guard
                processedCount++;
                continue;
            }
            console.log(`[AUDIT] [ap-content-production] Processing item ${item.id} via AI. Action: ${actionType}. Employee: ${isEmployeeGenerated}`);


            let finalOpenAiKey = "";
            let finalModel = OPENAI_MODEL_G;
            let prompt = "";
            let context = null;

            if (clienteId) {
                context = await getEditorialContext(supabase, clienteId, item.conteudo || item.titulo || "");
                if (context && context.settings && context.settings.vault_secret_id) {
                    const { data: secretData } = await supabase.rpc('get_decrypted_secret', { secret_id: context.settings.vault_secret_id });
                    if (secretData) finalOpenAiKey = secretData;
                }
            }

            if (!finalOpenAiKey) finalOpenAiKey = Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("OPENAI_API_KEY") || "";
            if (!finalOpenAiKey) throw new Error("Missing LLM Key for Tenant " + clienteId);

            if (actionType === "process_studio") {
                prompt = buildStudioPrompt({
                    titulo: item.titulo,
                    conteudo: item.conteudo,
                    categoria: item.categoria,
                    url_original: item.url_original,
                    settings: context?.settings || {},
                    promptVersion: context?.promptVersion,
                    humanization: context?.humanization,
                    rules: context?.rules || [],
                    ragContext: context?.ragContext || [],
                    openaiKey: finalOpenAiKey
                });
            } else {
                prompt = await buildEditorialPrompt(supabase, {
                    titulo: item.titulo,
                    conteudo: item.conteudo,
                    categoria: item.categoria,
                    url_original: item.url_original,
                    settings: context?.settings || {},
                    promptVersion: context?.promptVersion,
                    humanization: context?.humanization,
                    rules: context?.rules || [],
                    ragContext: context?.ragContext || [],
                    openaiKey: finalOpenAiKey,
                    contentType: item.content_type,
                    userHeadline,
                    userTag,
                    userText
                });
            }
            finalModel = context?.settings?.model_primary || OPENAI_MODEL_G;

            const { content } = await callLLM({
                apiKey: finalOpenAiKey,
                model: finalModel,
                prompt,
                baseUrl: context?.settings?.api_base_url || undefined,
                temperature: 0.7,
                maxTokens: 2000
            });

            // 5. Robust Parsing & Fallback
            let parsed: any = null;
            try {
                parsed = actionType === "process_studio" ? parseStudioOutput(content) : parseAiOutput(content);
            } catch (err) {
                console.error(`[AUDIT] [ap-content-production] Parsing failed for ${item.id}:`, err.message);
                // No return here — we'll use fallback below
            }

            let updatePayload: any = {};
            if (actionType === "process_studio") {
                updatePayload = {
                    roteiro_studio: parsed?.roteiro_studio || content,
                    duracao_estimada: parsed?.duracao_estimada || 60,
                    broll_sugestao: parsed?.broll_sugestao || "N/A",
                    status: "studio_selected",
                    processing_started_at: null
                };
            } else {
                // Fallback Priority Logic (Sovereignty)
                const finalHeadline = userHeadline || item.headline || parsed?.headline || item.titulo || "Pauta OMNI";
                const finalCaption = userText || item.caption || parsed?.caption || "";
                const finalTag = userTag || item.context_tag || parsed?.context_tag || item.categoria || "DESTAQUE";

                updatePayload = {
                    headline: finalHeadline,
                    caption: finalCaption,
                    roteiro_json: parsed?.roteiro || [],
                    context_tag: finalTag,
                    status: actionType === "approve_for_ig" ? "pending_render" : "selected",
                    processing_started_at: null
                };

                if (actionType === "approve_for_ig" && typeof body?.approved_by_id === "string") {
                    updatePayload.approved_by = body.approved_by_id;
                    updatePayload.approved_by_name = body.approved_by_name || "Editor";
                    updatePayload.approved_at = new Date().toISOString();
                }
            }

            await supabase.schema("ap").from("candidate_news").update(updatePayload).eq("id", item.id);

            // Log de Evento Editorial se for aprovação
            if (actionType === "approve_for_ig" && typeof body?.approved_by_id === "string") {
                await supabase.schema("ap").from("editorial_events").insert({
                    worker: "ap-content-production",
                    action: "approve_news",
                    news_id: item.id,
                    user_id: body.approved_by_id,
                    payload: updatePayload
                });
            }

            processedCount++;

        } catch (err: any) {
            errors.push({ id: item.id, error: err.message });
            await supabase.schema("ap").from("candidate_news").update({ processing_started_at: null }).eq("id", item.id);
        }
    }

    return new Response(JSON.stringify({ ok: true, found: items?.length ?? 0, locked: totalLocked, processed: processedCount, errors }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
});

function parseStudioOutput(raw: string) {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const parsed = JSON.parse(jsonMatch[0]);
    return {
        roteiro_studio: parsed.roteiro_teleprompter || parsed.roteiro_studio,
        duracao_estimada: parsed.duracao_estimada_segundos || 60,
        broll_sugestao: parsed.broll_sugestao
    };
}

function parseAiOutput(raw: string) {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const parsed = JSON.parse(jsonMatch[0]);
    return {
        headline: parsed.headline,
        caption: parsed.caption || parsed.legenda,
        roteiro: parsed.roteiro,
        context_tag: parsed.context_tag
    };
}
