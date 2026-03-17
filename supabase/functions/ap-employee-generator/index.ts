// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Employee Generator Worker (Hybrid Editorial Engine)
// Fluxo: Cria matéria manual -> IA (opcional) -> Status 'selected' (Pendentes)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runEditorialWorkflow } from "../_shared/editorialWorkflow.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};

const OPENAI_MODEL_G = "gpt-4o-mini";
declare const Deno: any;

async function fetchWithTimeout(resource: URL | RequestInfo, options = {}) {
    const { timeout = 8000, ...fetchOptions } = options as any;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(resource, { ...fetchOptions, signal: controller.signal });
    clearTimeout(id);
    return response;
}

function isUUID(str: string) {
    if (!str || typeof str !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
}

function isValidUrl(str: string) {
    if (!str || typeof str !== 'string') return false;
    try {
        new URL(str);
        return true;
    } catch {
        return false;
    }
}

function normalizePayload(payload: any) {
    const normalized: any = {};
    for (const key in payload) {
        const val = payload[key];
        normalized[key] = (val === undefined || val === "") ? null : val;
    }
    return normalized;
}

async function resolveTemplate(supabase: any, template_set: string, empresa_id: string, content_type: string) {
    console.log(`[AUDIT] [ap-employee-generator] Resolvendo template automático via RPC get_and_advance_template para set=${template_set}, empresa=${empresa_id}, tipo=${content_type}`);
    
    // ATENTION: ap-employee-generator must actively advance the queue 
    // to prevent the same template (e.g. Luiza Medeiros) from being used repeatedly
    const { data: templateData, error } = await supabase.schema("ap")
        .rpc("get_and_advance_template", {
            p_empresa_id: empresa_id,
            p_tipo: content_type,
            p_template_set: template_set
        });

    if (error || !templateData) {
        console.error("[GENERATOR_ERROR] Erro ao rotacionar template via RPC:", error?.message || "Sem dados");
        return null;
    }

    const resolved = templateData.placid_template_uuid || null;
    const resolved_id = templateData.id || null;
    
    console.log("[AUDIT][TEMPLATE_ROTATED]", {
        template_id: resolved_id,
        placid_template_uuid: resolved,
        ordem: templateData.ordem,
        nome: templateData.nome,
        content_type: content_type,
        template_set,
        empresa_id
    });
    
    return resolved;
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const body = await req.json();
        console.log("[AUDIT][GENERATOR_REQUEST_BODY]", body);
        const {
            titulo,
            conteudo,
            imagem_url: raw_imagem_url,
            image_url: raw_image_url,
            empresa_id,
            auth_user_id,
            url_original,
            content_type = 'feed',
            userHeadline: rawUserHeadline,
            userTag: rawUserTag,
            context_tag: rawContextTag,
            userText: rawUserText,
            template_set: raw_template_set = 'default',
            placid_template_uuid: raw_placid_uuid = null
        } = body;

        let placid_template_uuid = raw_placid_uuid;
        const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

        console.log("[AUDIT][GENERATOR_PAYLOAD]", body);

        // 1. Validation & Sanitization
        if (!empresa_id) {
            const reason = "empresa_id é obrigatório";
            console.error("[GENERATOR_ERROR]", reason);
            return new Response(JSON.stringify({ error: "VALIDATION_ERROR", message: reason }), { status: 400, headers: corsHeaders });
        }
        if (!isUUID(empresa_id)) {
            const reason = `UUID inválido para empresa_id: ${empresa_id}`;
            console.error("[GENERATOR_ERROR]", reason);
            return new Response(JSON.stringify({ error: "VALIDATION_ERROR", message: reason }), { status: 400, headers: corsHeaders });
        }
        
        if (auth_user_id && auth_user_id !== 'null' && !isUUID(auth_user_id)) {
            console.warn(`[AUDIT] [ap-employee-generator] UUID inválido para auth_user_id: ${auth_user_id}. Ignorando.`);
        }
        const finalAuthUserId = (auth_user_id && auth_user_id !== 'null' && isUUID(auth_user_id)) ? auth_user_id : null;

        const validTypes = ["feed", "reels"];
        if (!validTypes.includes(content_type)) {
            const reason = `content_type inválido: ${content_type}`;
            console.error("[GENERATOR_ERROR]", reason);
            return new Response(JSON.stringify({ error: "VALIDATION_ERROR", message: reason }), { status: 400, headers: corsHeaders });
        }

        // 1b. titulo & conteudo validation
        if (!titulo || String(titulo).trim().length < 2) {
            const reason = "titulo é obrigatório para geração (mínimo 2 caracteres)";
            console.error("[GENERATOR_ERROR]", { reason, payload: body });
            return new Response(JSON.stringify({ error: "VALIDATION_ERROR", message: reason }), { status: 400, headers: corsHeaders });
        }
        if (!conteudo || String(conteudo).trim().length < 5) {
            const reason = "conteudo é muito curto ou ausente (mínimo 5 caracteres)";
            console.error("[GENERATOR_ERROR]", { reason, payload: body });
            return new Response(JSON.stringify({ error: "VALIDATION_ERROR", message: reason }), { status: 400, headers: corsHeaders });
        }

        if (!placid_template_uuid) {
            const resolved = await resolveTemplate(supabase, raw_template_set || 'default', empresa_id, content_type);
            if (!resolved) {
                console.error("[GENERATOR_ERROR] Template not found", {
                    empresa_id,
                    template_set: raw_template_set,
                    content_type
                });
                return new Response(JSON.stringify({ 
                    error: "TEMPLATE_NOT_FOUND", 
                    message: "No active template available for feed generation" 
                }), { status: 400, headers: corsHeaders });
            }
            placid_template_uuid = resolved;
        }

        const imagem_url = raw_imagem_url || raw_image_url || null;
        if (imagem_url && !isValidUrl(imagem_url)) {
            const reason = `Formato de imagem_url inválido: ${imagem_url}`;
            console.error("[GENERATOR_ERROR]", reason);
            return new Response(JSON.stringify({ error: "VALIDATION_ERROR", message: reason }), { status: 400, headers: corsHeaders });
        }

        const userHeadline = (typeof rawUserHeadline === 'string' && rawUserHeadline.trim()) ? rawUserHeadline.trim() : null;
        const userTag = (rawUserTag || rawContextTag) ? String(rawUserTag || rawContextTag).toUpperCase().trim() : null;
        const userText = (typeof rawUserText === 'string' && rawUserText.trim()) ? rawUserText.trim() : null;
        const contextTagForInsert = userTag ?? 'DESTAQUE';

        // Imagem não é obrigatória — scraping tentará buscar do url_original
        if (!url_original && !imagem_url) {
            console.warn("[AUDIT] [ap-employee-generator] Nenhuma imagem ou link fornecido. Prosseguindo sem imagem.");
        }

        // 1. Resolver Template (Manual ou Automático via Render Engine)
        let template_id = null;
        let template_ordem = null;
        let template_nome_snapshot = null;
        const template_set = raw_template_set || 'default';

        if (placid_template_uuid) {
            console.log(`[AUDIT] [ap-employee-generator] Template Manual detectado: ${placid_template_uuid}`);
            const { data: tData } = await supabase.schema("ap").from("templates")
                .select("id, nome, ordem")
                .eq("placid_template_uuid", placid_template_uuid)
                .limit(1)
                .single();

            if (tData) {
                template_id = tData.id;
                template_ordem = tData.ordem;
                template_nome_snapshot = tData.nome;
            }
        } else {
            console.log(`[AUDIT] [ap-employee-generator] Rotação automática solicitada (UUID nulo).`);
        }

        // 3. Criar registro inicial como 'processing' para esconder do UI e travar
        let newsItem = null;
        let normalizedPayload = null;
        try {
            const rawPayload = {
                cliente_id: empresa_id,
                titulo: userHeadline || titulo || "Pauta OMNI",
                conteudo: userText || conteudo || "",
                url_original: url_original || null,
                context_tag: contextTagForInsert,
                status: "processing",
                source: "employee",
                imagem_url: imagem_url,
                content_type: content_type,
                criado_por_user_id: finalAuthUserId,
                role_criador: "employee",
                generated_by: "employee",
                origin: "manual",
                template_id: template_id,
                template_ordem: template_ordem,
                placid_template_uuid: placid_template_uuid,
                template_nome_snapshot: template_nome_snapshot,
                template_set: template_set,
                gerado_em: new Date().toISOString()
            };

            normalizedPayload = normalizePayload(rawPayload);

            const { data, error: insertError } = await supabase.schema("ap").from("candidate_news")
                .insert(normalizedPayload)
                .select("id")
                .single();

            if (insertError) throw insertError;
            newsItem = data;
        } catch (dbErr: any) {
            console.error("[GENERATOR_ERROR][DB_INSERT_FAILED]", { 
                error: dbErr.message, 
                payload: normalizedPayload 
            });
            return new Response(JSON.stringify({ 
                error: "Falha ao criar registro no banco.", 
                details: dbErr.message 
            }), { status: 400, headers: corsHeaders });
        }

        const newsId = newsItem.id;
        console.log(`[AUDIT] [ap-employee-generator] Registro criado! ID: ${newsId}`);

        // 3. Backend Scraping Fallback & Internalization
        let finalImage = imagem_url;
        let storagePath = null;
        let imageExternal = false;
        const BUCKET = "ap-images";

        // a) Scraping Fallback (if no image)
        if (!finalImage && url_original) {
            console.log(`[AUDIT] [ap-employee-generator] Scraping fallback for: ${url_original}`);
            try {
                const scrapeRes = await fetchWithTimeout(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ap-link-scraper`, {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ url: url_original }),
                    timeout: 5000
                });
                if (scrapeRes.ok) {
                    const scrapeData = await scrapeRes.json();
                    if (scrapeData.image_url) finalImage = scrapeData.image_url;
                }
            } catch (e: any) { console.warn("[AUDIT] Scraping falhou:", e.message); }
        }

        // b) Internalization (Production Grade)
        if (finalImage) {
            try {
                const baseHeaders = {
                    "User-Agent": "Mozilla/5.0",
                    "Referer": "https://g1.globo.com",
                    "Accept": "image/avif,image/webp,*/*;q=0.8"
                };
                const urlsToTry = [finalImage];
                if (finalImage.includes(".glbimg.com")) {
                    const urlParts = finalImage.split("https://");
                    if (urlParts.length > 2) {
                        const directUrl = "https://" + urlParts[urlParts.length - 1];
                        if (directUrl.includes(".glbimg.com")) {
                            urlsToTry.push(directUrl);
                        }
                    } else {
                        const httpParts = finalImage.split("http://");
                        if (httpParts.length > 2) {
                            const directUrl = "http://" + httpParts[httpParts.length - 1];
                            if (directUrl.includes(".glbimg.com")) {
                                urlsToTry.push(directUrl);
                            }
                        }
                    }
                }

                let imgRes: Response | null = null;
                for (const url of urlsToTry) {
                    try {
                        imgRes = await fetch(url, { headers: baseHeaders });
                        if (imgRes.ok) break;
                    } catch (e) { console.warn(`[AUDIT] Fetch fail: ${url}`); }
                }

                if (imgRes && imgRes.ok) {
                    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
                    const buffer = new Uint8Array(await imgRes.arrayBuffer());

                    if (buffer.length < 10 * 1024 * 1024) {
                        const hex = Array.from(buffer.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join('');
                        if (!hex.startsWith('3c')) { // Not HTML
                            let ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
                            storagePath = `${newsId}.${ext}`;
                            const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, { contentType, upsert: true });
                            if (upErr) storagePath = null;
                        }
                    }
                }
            } catch (e) { console.error("[AUDIT] Internalization failed", e); }
        }

        imageExternal = (storagePath === null && finalImage !== null);
        // Atualiza imagem_url e storage antes de ir pra IA
        await supabase.schema("ap").from("candidate_news")
            .update({ imagem_url: finalImage, imagem_storage: storagePath, image_external: imageExternal })
            .eq("id", newsId);

        const failProcess = async (msg: string) => {
            console.error(`[AUDIT] [ap-employee-generator] Falha: ${msg}`);
            try {
                await supabase.schema("ap").from("candidate_news")
                    .update({ status: "failed", processing_started_at: null })
                    .eq("id", newsId);
            } catch (err) {
                console.error(`[AUDIT] [ap-employee-generator] Erro ao marcar como falha:`, err);
            }
            return new Response(JSON.stringify({ error: msg }), { status: 400, headers: corsHeaders });
        };

        // 4. Shared Editorial Workflow (AI Processing)
        console.log(`[FLOW] Triggering shared editorial workflow for ${newsId}`);
        const result = await runEditorialWorkflow(supabase, {
            newsId,
            clienteId: empresa_id,
            userHeadline,
            userTag,
            userText,
            contentType: content_type as any
        });

        // 6. Salvamento Final — Employee items agora vão para 'pending_render' (bypass aprovação)
        const { error: finalUpdErr } = await supabase.schema("ap").from("candidate_news")
            .update({
                status: "pending_render", // Pula a aprovação humana
                headline: result.headline,
                caption: result.caption,
                context_tag: result.context_tag,
                roteiro_json: result.roteiro_json,
                processing_started_at: null
            })
            .eq("id", newsId);

        if (finalUpdErr) throw finalUpdErr;

        console.log(`[FLOW] [ap-employee-generator] Item ${newsId} -> pending_render. Queued for worker.`);

        return new Response(JSON.stringify({
            success: true,
            news_id: newsId,
            status: "pending_render",
            headline: result.headline,
            caption: result.caption,
            context_tag: result.context_tag,
            render_pending: true // Inicia polling no frontend
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (e: any) {
        console.error(`[GENERATOR_ERROR]`, e.message);
        return new Response(JSON.stringify({ 
            error: "INTERNAL_ERROR",
            message: e.message || "Erro interno no servidor",
            stack: Deno.env.get("ENVIRONMENT") === "development" ? e.stack : undefined
        }), { status: 400, headers: corsHeaders });
    }
});
