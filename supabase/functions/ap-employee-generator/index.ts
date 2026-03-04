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
            p_tipo: content_type
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

        // 3. Backend Scraping Fallback
        let finalImage = imagem_url;
        if (!finalImage && url_original) {
            console.log(`[AUDIT] [ap-employee-generator] Tentando scraping de imagem para: ${url_original}`);
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
                    if (scrapeData.image_url) {
                        finalImage = scrapeData.image_url;
                        console.log(`[AUDIT] [ap-employee-generator] Scraping sucesso: ${finalImage}`);
                        await supabase.schema("ap").from("candidate_news")
                            .update({ imagem_url: finalImage })
                            .eq("id", newsId);
                    }
                }
            } catch (e: any) {
                console.warn("[AUDIT] [ap-employee-generator] Scraping falhou:", e.message);
            }
        }

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

        let parsedData: any;
        try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            parsedData = JSON.parse(jsonMatch ? jsonMatch[0] : content);
        } catch (e) {
            console.error("[AUDIT] [ap-employee-generator] JSON Parse Error:", content);
            return failProcess("Erro ao processar resposta da IA.");
        }

        // 5. Merge de Prioridade Humana
        const resolvedHeadline = userHeadline ?? parsedData.headline;
        const resolvedTag = userTag ?? parsedData.context_tag;
        const finalCaption = userText ?? (parsedData.caption || parsedData.legenda);

        console.log(`[AUDIT] [ap-employee-generator] Merge Final: Tag=${resolvedTag}, Headline=${resolvedHeadline}`);

        // 6. Salvamento Final em Status 'selected' (MUITO IMPORTANTE!)
        const { error: finalUpdErr } = await supabase.schema("ap").from("candidate_news")
            .update({
                status: "selected",
                headline: resolvedHeadline,
                caption: finalCaption,
                context_tag: resolvedTag,
                roteiro_json: parsedData.roteiro || null,
                processing_started_at: null // Libera lock
            })
            .eq("id", newsId);

        if (finalUpdErr) throw finalUpdErr;

        console.log(`[AUDIT] [ap-employee-generator] Sucesso! Item ID: ${newsId} agora está 'selected'.`);

        return new Response(JSON.stringify({
            success: true,
            news_id: newsId,
            status: "selected",
            headline: resolvedHeadline,
            caption: finalCaption,
            context_tag: resolvedTag
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (e: any) {
        console.error(`[AUDIT] [ap-employee-generator] Erro Global:`, e.message);
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: corsHeaders });
    }
});
