// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Camada 8: Render Engine Worker (Optimized with Sponsor Rotation)
// Chama API de render (Placid) com suporte a Polling e Rotação de Patrocinadores.
// verify_jwt: false
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};
const BATCH_LIMIT = 5;
Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const renderApiKey = Deno.env.get("RENDER_API_KEY");
    const globalTemplateId = Deno.env.get("RENDER_TEMPLATE_ID");

    if (!renderApiKey) {
        return new Response(JSON.stringify({ error: "RENDER_API_KEY not configured" }), { status: 500 });
    }

    // Suporte a execução direcionada (ex: matéria manual)
    let targetNewsId: string | null = null;
    try {
        if (req.method === "POST") {
            const contentType = req.headers.get("Content-Type") || "";
            if (contentType.includes("application/json")) {
                const body = await req.json().catch(() => null);
                if (body && body.action === "render_one" && typeof body.newsId === "string") {
                    targetNewsId = body.newsId;
                }
            }
        }
    } catch (e) {
        console.error("[ap-render-engine] Failed to parse request body:", e);
    }

    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    let query = supabase
        .schema("ap").from("candidate_news")
        .select(`
            id, 
            cliente_id, 
            headline, 
            imagem_storage, 
            imagem_url, 
            categoria, 
            patrocinador_id, 
            context_tag, 
            placid_template_uuid, 
            content_type
        `)
        .eq("status", "pending_render");

    if (targetNewsId) {
        query = query.eq("id", targetNewsId);
    } else {
        query = query
            .or(`processing_started_at.is.null,processing_started_at.lt.${cutoff}`)
            .limit(BATCH_LIMIT);
    }

    const { data: items, error: fetchErr } = await query;
    if (fetchErr) {
        console.error("[ap-render-engine] Fetch items error:", fetchErr);
    }

    const results: any[] = [];
    const promises = (items ?? []).map(async (item) => {
        // Atomic Lock - set to 'processing' as per requirement
        const { data: lockData, error: lockErr } = await supabase
            .schema("ap").from("candidate_news")
            .update({ processing_started_at: new Date().toISOString(), status: 'processing' })
            .eq("id", item.id)
            .eq("status", "pending_render")
            .select("id");

        if (lockErr || !lockData || lockData.length === 0) {
            console.warn(`[ap-render-engine] Falha ao travar item ${item.id}:`, lockErr?.message || "Não encontrado ou já travado");
            return;
        }

        try {
            let activeTemplateId = item.placid_template_uuid;
            let snapshotData = null;

            if (!activeTemplateId) {
                // If not pre-assigned, consume from global queue
                const empresaId = item.cliente_id;
                if (!empresaId) {
                    throw new Error("Não foi possível resolver cliente_id da notícia.");
                }

                const queueType = item.content_type || 'feed';

                // Get the template from the queue (must use Service Role and Atomic consumption)
                const { data: templateData, error: templateErr } = await supabase
                    .schema('ap')
                    .rpc("get_and_advance_template", {
                        p_empresa_id: empresaId,
                        p_tipo: queueType
                    });

                if (templateErr || !templateData || !templateData.placid_template_uuid) {
                    throw new Error(`Fila vazia ou erro ao buscar template: ${templateErr?.message || 'Nenhum template ativo'}`);
                }

                activeTemplateId = templateData.placid_template_uuid;
                snapshotData = templateData; // save snapshot

                // Update candidate_news with assigned template string and snapshot
                await supabase.schema("ap").from("candidate_news")
                    .update({
                        placid_template_uuid: activeTemplateId,
                        template_nome_snapshot: templateData.nome || null
                    })
                    .eq("id", item.id);
            }

            if (!activeTemplateId) {
                activeTemplateId = globalTemplateId; // Fallback extremo se tudo falhar, mas logica pede erro.
                if (!activeTemplateId) throw new Error("No template_id found");
            }

            // Build image URL
            let bgImage = item.imagem_url;
            if (item.imagem_storage) {
                bgImage = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/ap-images/${item.imagem_storage}`;
            }

            // Tag Priority: MUST use context_tag from DB (already consolidated by generator/content-production)
            // No fallback to 'categoria' allowed per Human-in-the-Loop rules.
            const resolvedTag = item.context_tag || "DESTAQUE";

            if (!item.headline || item.headline.length < 3) {
                throw new Error("Render abortado: headline inválida ou ausente no banco.");
            }
            if (!resolvedTag) {
                throw new Error("Render abortado: tag (context_tag) ausente no banco.");
            }
            // Imagem obrigatória apenas para feed; Reels pode usar o template sem background
            if (!bgImage && item.content_type !== 'reels') {
                throw new Error("Render abortado: imagem_url ausente no banco.");
            }

            // Build layers object — only include news-image when an image is available
            const layers: Record<string, any> = {
                "headline_news": { text: item.headline },
                "tag_news": { text: resolvedTag },
            };
            if (bgImage) {
                layers["news-image"] = { image: bgImage };
            }

            const renderPayload = {
                template_uuid: activeTemplateId,
                layers,
            };

            // Call Placid REST API
            const renderRes = await fetch("https://api.placid.app/api/rest/images", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${renderApiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(renderPayload),
            });

            if (renderRes.ok) {
                const data = await renderRes.json();
                let finalUrl = data.image_url;
                const pollingUrl = data.polling_url;

                // Polling Loop for Async Rendering (MÁXIMO 10 tentativas para evitar timeouts do servidor)
                if (!finalUrl && pollingUrl) {
                    console.log(`[ap-render-engine] Polling iniciado: ${pollingUrl}`);
                    for (let i = 0; i < 10; i++) {
                        await new Promise(r => setTimeout(r, 3000));
                        const pollRes = await fetch(pollingUrl, {
                            headers: { "Authorization": `Bearer ${renderApiKey}` }
                        });
                        if (pollRes.ok) {
                            const pollData = await pollRes.json();
                            if (pollData.status === "finished" && pollData.image_url) {
                                finalUrl = pollData.image_url;
                                console.log(`[ap-render-engine] Polling sucesso: ${finalUrl}`);
                                break;
                            }
                        }
                    }
                }

                if (finalUrl) {
                    try {
                        console.log(`[ap-render-engine] Internalizando render final a partir de: ${finalUrl}`);
                        const renderDlRes = await fetch(finalUrl);
                        if (!renderDlRes.ok) throw new Error("HTTP Status " + renderDlRes.status);

                        const contentType = renderDlRes.headers.get("content-type") || "image/jpeg";
                        // Save in structure ap-renders/{empresa_id}/{item_id}.jpg
                        const empresaId = item.cliente_id;
                        const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
                        const internalPath = `${empresaId}/${item.id}.${ext}`;

                        const arrayBuffer = await renderDlRes.arrayBuffer();
                        const buffer = new Uint8Array(arrayBuffer);

                        const { error: uploadError } = await supabase.storage
                            .from("ap-renders")
                            .upload(internalPath, buffer, { contentType, upsert: true });

                        if (uploadError) throw new Error("Supabase Storage Upload falhou: " + uploadError.message);

                        const publicRenderUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/ap-renders/${internalPath}`;

                        await supabase.schema("ap").from("candidate_news").update({
                            render_url: publicRenderUrl,
                            status: "ready_to_publish",
                            processing_started_at: null,
                            completed_at: new Date().toISOString()
                        }).eq("id", item.id);
                        results.push({ id: item.id, status: "success", url: publicRenderUrl });
                    } catch (dlErr: any) {
                        console.error(`[ap-render-engine] Falha ao internalizar imagem de ${item.id}:`, dlErr);
                        await supabase.schema("ap").from("candidate_news").update({
                            status: "failed",
                            processing_started_at: null
                        }).eq("id", item.id);
                        results.push({ id: item.id, status: "error", error: dlErr.message });
                    }
                } else {
                    // Sem URL após 10 tentativas = Timeout e falha. Sem Webhook configurado, a matéria ficaria travada sem imagem.
                    await supabase.schema("ap").from("candidate_news").update({
                        status: "failed",
                        processing_started_at: null
                    }).eq("id", item.id);
                    results.push({ id: item.id, status: "pending_async", message: "Timeout de polling. Render continuará no background pelo Placid." });
                }
            } else {
                const errText = await renderRes.text();
                throw new Error(`Placid REST Error ${renderRes.status}: ${errText}`);
            }
        } catch (err: any) {
            console.error(`[ap-render-engine] item ${item.id}:`, err.message);
            results.push({ id: item.id, status: "error", error: err.message });
            // Error handling matching instructions: never return to queue, set status = 'failed'
            await supabase.schema("ap").from("candidate_news").update({
                status: "failed",
                processing_started_at: null
            }).eq("id", item.id);
        }
    });

    await Promise.allSettled(promises);

    return new Response(JSON.stringify({ ok: true, processed: items?.length ?? 0, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
});
