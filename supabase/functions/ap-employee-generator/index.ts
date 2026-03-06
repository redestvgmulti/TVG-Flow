// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Employee Generator Worker (Hybrid Editorial Engine)
// Fluxo: Cria matéria manual -> IA (opcional) -> Status 'selected' (Pendentes)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildEditorialPrompt, getEditorialContext } from "../_shared/editorialPromptBuilder.ts";
import { callLLM } from "../_shared/llmClient.ts";

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

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const body = await req.json();
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
            template_set = 'default',
        } = body;

        console.log(`[AUDIT] [ap-employee-generator] Invocado para Empresa: ${empresa_id}, Link: ${url_original}`);
        console.log(`[AUDIT] [ap-employee-generator] Payload Recebido:`, JSON.stringify(body));

        if (!empresa_id) throw new Error("empresa_id obrigatório");

        const imagem_url = raw_image_url || raw_imagem_url || null;
        const userHeadline = (typeof rawUserHeadline === 'string' && rawUserHeadline.trim()) ? rawUserHeadline.trim() : null;
        const userTag = (rawUserTag || rawContextTag) ? String(rawUserTag || rawContextTag).toUpperCase().trim() : null;
        const userText = (typeof rawUserText === 'string' && rawUserText.trim()) ? rawUserText.trim() : null;
        const contextTagForInsert = userTag ?? 'DESTAQUE';

        // Imagem não é obrigatória — scraping tentará buscar do url_original
        if (!url_original && !imagem_url) {
            console.warn("[AUDIT] [ap-employee-generator] Nenhuma imagem ou link fornecido. Prosseguindo sem imagem.");
        }

        const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

        // 1. Reservar template
        const { data: templateData, error: rpcError } = await supabase.schema("ap").rpc("get_and_advance_template", {
            p_empresa_id: empresa_id,
            p_tipo: content_type,
            p_template_set: template_set
        });

        if (rpcError || !templateData) {
            console.error("[AUDIT] [ap-employee-generator] RPC Template Error:", rpcError);
            throw new Error("Nenhum template ativo cadastrado.");
        }

        console.log(`[AUDIT] [ap-employee-generator] Template: ${templateData.nome}`);

        // 2. Criar registro inicial como 'processing' para esconder do UI e travar
        const { data: newsItem, error: insertError } = await supabase.schema("ap").from("candidate_news")
            .insert({
                cliente_id: empresa_id,
                titulo: userHeadline || titulo || "Pauta OMNI",
                conteudo: userText || conteudo || "",
                url_original: url_original || null,
                context_tag: contextTagForInsert,
                status: "processing",
                source: "employee",
                imagem_url: imagem_url,
                content_type: content_type,
                criado_por_user_id: auth_user_id || null,
                role_criador: "employee",
                template_id: templateData.id,
                template_ordem: templateData.ordem,
                placid_template_uuid: templateData.placid_template_uuid,
                template_nome_snapshot: templateData.nome,
                template_set: templateData.template_set || template_set,
                gerado_em: new Date().toISOString()
            })
            .select("id")
            .single();

        if (insertError || !newsItem) {
            console.error("[AUDIT] [ap-employee-generator] Insert Error:", insertError);
            throw new Error("Erro ao criar registro no banco.");
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

        // 4. Inteligência Artificial
        let finalOpenAiKey = "";
        let context = await getEditorialContext(supabase, empresa_id, userText || conteudo || titulo || "");

        if (context?.settings?.vault_secret_id) {
            const { data: secretData } = await supabase.rpc('get_decrypted_secret', { secret_id: context.settings.vault_secret_id });
            if (secretData) finalOpenAiKey = secretData;
        }
        if (!finalOpenAiKey) finalOpenAiKey = Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("OPENAI_API_KEY") || "";
        if (!finalOpenAiKey) return failProcess("Chave de API ausente.");

        const prompt = await buildEditorialPrompt(supabase, {
            titulo: userHeadline || titulo || "Pauta OMNI",
            conteudo: userText || conteudo || "",
            categoria: userTag || "Geral",
            url_original: url_original || null,
            settings: context?.settings || { cliente_id: empresa_id },
            promptVersion: context?.promptVersion,
            humanization: context?.humanization,
            rules: context?.rules || [],
            ragContext: context?.ragContext || [],
            openaiKey: finalOpenAiKey,
            contentType: content_type as any,
            userHeadline,
            userTag,
            userText
        });

        const model = context?.settings?.model_primary || OPENAI_MODEL_G;
        console.log(`[AUDIT] [ap-employee-generator] Chamando IA (${model})...`);

        const { content } = await callLLM({
            apiKey: finalOpenAiKey,
            model: model,
            prompt: prompt,
            baseUrl: context?.settings?.api_base_url || undefined,
            temperature: context?.settings?.temperature || 0.7,
            maxTokens: 1500
        });

        let parsedData: any = null;
        try {
            // Robust extraction: try multiple JSON block patterns
            const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) ||
                content.match(/```([\s\S]*?)```/) ||
                content.match(/(\{[\s\S]*\})/);
            const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
            parsedData = JSON.parse(jsonStr.trim());
        } catch (e) {
            console.warn("[AUDIT] [ap-employee-generator] JSON Parse falhou — usando fallback humano.", content.slice(0, 200));
            parsedData = {}; // Will use human data fallback below
        }

        // 5. Merge de Prioridade Humana
        // Caption: AI expands userText → use parsed.caption as the final expanded version.
        // Only fall back to userText/conteudo if AI failed to return a valid caption.
        const resolvedHeadline = userHeadline ?? parsedData.headline ?? titulo ?? "Pauta OMNI";
        const resolvedTag = userTag ?? parsedData.context_tag ?? "DESTAQUE";
        const finalCaption = (parsedData.caption || parsedData.legenda) ?? userText ?? conteudo ?? "";

        if (!resolvedHeadline) return failProcess("Headline ausente após merge.");

        console.log(`[AUDIT] [ap-employee-generator] Merge Final: Tag=${resolvedTag}, Headline=${resolvedHeadline}`);

        // 6. Salvamento Final — Employee items vão direto para 'pending_render' (sem aprovação admin)
        const { error: finalUpdErr } = await supabase.schema("ap").from("candidate_news")
            .update({
                status: "pending_render",
                headline: resolvedHeadline,
                caption: finalCaption,
                context_tag: resolvedTag,
                roteiro_json: parsedData.roteiro || null,
                processing_started_at: null // Libera lock para render engine
            })
            .eq("id", newsId);

        if (finalUpdErr) throw finalUpdErr;

        console.log(`[AUDIT] [ap-employee-generator] Item ${newsId} -> pending_render. Disparando render imediato...`);

        // 7. Disparar ap-render-engine imediatamente (fire-and-forget, não bloqueia resposta)
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const renderEngineUrl = `${supabaseUrl}/functions/v1/ap-render-engine`;

        // Fire-and-forget: não aguardamos para não estourar timeout do employee-generator
        fetch(renderEngineUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${serviceKey}`
            },
            body: JSON.stringify({ action: "render_one", newsId })
        }).then(res => {
            console.log(`[AUDIT] [ap-employee-generator] Render engine invocado para ${newsId}: ${res.status}`);
        }).catch(err => {
            console.error(`[AUDIT] [ap-employee-generator] Falha ao invocar render engine para ${newsId}:`, err.message);
        });

        return new Response(JSON.stringify({
            success: true,
            news_id: newsId,
            status: "pending_render",
            headline: resolvedHeadline,
            caption: finalCaption,
            context_tag: resolvedTag,
            render_pending: true // Signal to frontend to start polling
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (e: any) {
        console.error(`[AUDIT] [ap-employee-generator] Erro Global:`, e.message);
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: corsHeaders });
    }
});
