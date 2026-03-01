// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Employee Generator Worker
// Fluxo síncrono: Reserva template via Fila Global, processa IA, renderiza no Placid e retorna.
// verify_jwt: false
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildEditorialPrompt } from "../_shared/editorialPromptBuilder.ts";
import { callLLM } from "../_shared/llmClient.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};

// Fallback Model
const OPENAI_MODEL_G = "gpt-4o-mini";

// Para lidar com os erros de Deno namespace no VSCode/Supabase
declare const Deno: any;

// Timeout implementation for fetch
async function fetchWithTimeout(resource: URL | RequestInfo, options = {}) {
    const { timeout = 8000, ...fetchOptions } = options as any;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(resource, {
        ...fetchOptions,
        signal: controller.signal
    });
    clearTimeout(id);
    return response;
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const body = await req.json();
        const { titulo, conteudo, imagem_url, empresa_id, auth_user_id, context_tag, url_original } = body;

        if (!empresa_id) {
            return new Response(JSON.stringify({ error: "empresa_id obrigatório" }), { status: 400, headers: corsHeaders });
        }

        const supabase = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
            { auth: { autoRefreshToken: false, persistSession: false } }
        );

        const renderApiKey = Deno.env.get("RENDER_API_KEY");
        if (!renderApiKey) {
            return new Response(JSON.stringify({ error: "RENDER_API_KEY ausente" }), { status: 400, headers: corsHeaders });
        }

        // 1. Chamar RPC para obter o template da Fila Global (Transacional)
        const { data: templateData, error: rpcError } = await supabase.rpc("get_and_advance_template", {
            p_empresa_id: empresa_id
        });

        if (rpcError || !templateData) {
            console.error("[ap-employee-generator] Falha ao recuperar/avançar template:", rpcError);
            return new Response(JSON.stringify({ error: "Fila de Templates vazia ou erro: " + (rpcError?.message || 'Nenhum template ativo') }), { status: 400, headers: corsHeaders });
        }

        // templateData retornado via JSONB: { id, placid_template_uuid, ordem, nome }
        console.log(`[ap-employee-generator] Template Reservado: ${templateData.nome} (Ordem: ${templateData.ordem})`);

        // 2. Criar registro inicial (processing)
        const { data: newsItem, error: insertError } = await supabase.schema("ap").from("candidate_news")
            .insert({
                cliente_id: empresa_id,
                titulo: titulo || "Pauta OMNI",
                conteudo: conteudo || "",
                url_original: url_original || null,
                context_tag: context_tag ? context_tag.toUpperCase() : null,
                status: "processing",
                source: "employee",
                imagem_url: imagem_url || null,
                criado_por_user_id: auth_user_id || null, // Recebido via payload
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
            console.error("[ap-employee-generator] Falha ao criar registro news:", insertError);
            return new Response(JSON.stringify({ error: "Erro de Unicidade/Banco de Dados: " + insertError?.message }), { status: 400, headers: corsHeaders });
        }

        const newsId = newsItem.id;

        const failProcess = async (msg: string) => {
            await supabase.schema("ap").from("candidate_news")
                .update({ status: "failed", caption: msg })
                .eq("id", newsId);
            return new Response(JSON.stringify({ error: msg }), { status: 400, headers: corsHeaders });
        };

        // 3. Processar Texto via IA
        // Criar config mínima ou buscar se quiser o RAG
        const prompt = await buildEditorialPrompt(supabase, {
            titulo: titulo || "Pauta OMNI",
            conteudo: conteudo || "",
            categoria: context_tag || "geral",
            url_original: url_original || null,
            settings: { cliente_id: empresa_id },
            promptVersion: "Você é um assistente rápido para formatação de cards patrocinados. Gere um texto direto, jornalístico e limpo em Português. Formate obrigatóriamente em JSON com as chaves: 'headline' (título curto e chamativo para o card), 'caption' (o texto da legenda para redes sociais) e 'tag' (palavra-chave, max 15 caracteres).",
            humanization: { formality_level: 50, creativity_level: 50, technical_level: 30 },
            rules: [],
            ragContext: [],
            openaiKey: Deno.env.get("OPENAI_API_KEY") || ""
        });

        // Ensure strict JSON return regardless of prompt overrides
        const strictJsonInstructions = "\n\nCRÍTICO E OBRIGATÓRIO: Você deve e apenas deve retornar um objeto JSON estritamente válido. O JSON tem que conter obrigatoriamente três (3) chaves escritas em letras minúsculas: 'headline' (string, mínimo de 10 caracteres, máx 30), 'caption' (string, texto para post de instagram com várias linhas, emojis e a fonte, mínimo de 20 caracteres) e 'tag' (string, max 15 caracteres). NÃO COLOQUE bloco markdown, NÃO COLOQUE crases antes do JSON. A primeira resposta deve ser '{' e a última '}'.";

        const promptArray = prompt + strictJsonInstructions;

        let parsedData: any = null;
        let aiResultStr = "";
        let attempt = 0;
        const maxAttempts = 2; // Try once, and retry once if failure
        let finalErrorMsg = "";

        while (attempt < maxAttempts) {
            try {
                let oaiKey = Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("OPENAI_API_KEY") || "";
                let baseUrl = Deno.env.get("OPENAI_BASE_URL") || "https://api.openai.com/v1";
                let model = OPENAI_MODEL_G;

                const { data: settingsData } = await supabase.schema('ap').from('editorial_settings').select('*').eq('cliente_id', empresa_id).single();
                if (settingsData) {
                    if (settingsData.vault_secret_id) {
                        const { data: secretData } = await supabase.rpc('get_decrypted_secret', { secret_id: settingsData.vault_secret_id });
                        if (secretData) oaiKey = secretData;
                    }
                    baseUrl = settingsData.api_base_url || baseUrl;
                    model = settingsData.model_primary || model;
                }

                // Append retry prefix if attempt > 0
                const finalPrompt = attempt === 0 ? promptArray : promptArray + "\n\nO RETORNO ANTERIOR FOI INVÁLIDO. Você deve retornar ÚNICA e EXCLUSIVAMENTE um objeto JSON válido, começando explicitamente por '{' e terminando por '}'. Sem texto em volta.";

                const { content } = await callLLM({
                    apiKey: oaiKey,
                    baseUrl: baseUrl,
                    model: model,
                    prompt: finalPrompt,
                    temperature: 0.7,
                    maxTokens: 1100
                });
                aiResultStr = content;

                // Strip potential markdown wrappers just in case
                const m = aiResultStr.match(/<json>([\s\S]*?)<\/json>/);
                let jsonContent = m ? m[1] : aiResultStr;

                // Also strip markdown json ticks if they exist
                jsonContent = jsonContent.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();

                parsedData = JSON.parse(jsonContent);

                // Validation rules
                if (!parsedData.headline || typeof parsedData.headline !== 'string' || parsedData.headline.length < 10) {
                    throw new Error("Invalid 'headline'. Must be a string of at least 10 chars.");
                }
                if (!parsedData.caption || typeof parsedData.caption !== 'string' || parsedData.caption.length < 20) {
                    throw new Error("Invalid 'caption'. Must be a string of at least 20 chars.");
                }
                if (!parsedData.tag || typeof parsedData.tag !== 'string') {
                    throw new Error("Invalid 'tag'.");
                }

                // If we got here, JSON is valid and required fields are present
                break;
            } catch (e: any) {
                console.error(`[ap-employee-generator] Attempt ${attempt + 1} failed:`, e);
                finalErrorMsg = e.message || "Parse/Validation Error";
                parsedData = null; // reset
            }
            attempt++;
        }

        if (!parsedData) {
            await supabase.schema("ap").from("candidate_news").update({ status: "failed_generation", caption: "Erro Crítico: " + finalErrorMsg }).eq("id", newsId);
            return failProcess(`Falha extrema após ${maxAttempts} tentativas de geração de IA (Formato Inválido). Detalhe: ${finalErrorMsg}`);
        }

        const resolvedTag = parsedData.tag || context_tag || "DESTAQUE";
        const headline = parsedData.headline || titulo || "Destaque OMNI";
        const caption = parsedData.caption || titulo || "";

        // 4.1. Prevent Broken Render Validation
        if (!headline || headline.trim().length === 0 || !caption || caption.trim().length === 0) {
            console.error("[ap-employee-generator] Empty headline/caption validation failed. Bailing Placid.");
            await supabase.schema("ap").from("candidate_news")
                .update({ status: "failed_generation", headline, caption, categoria: resolvedTag, context_tag: resolvedTag })
                .eq("id", newsId);
            return failProcess("Validação de conteúdo vazio. Abortando renderização.");
        }

        // Fallback de Imagem
        const bgImage = imagem_url || "https://images.unsplash.com/photo-1504711434969-e33886168f5c?q=80&w=1000&auto=format&fit=crop";

        // 5. Renderizar Imagem no Placid
        const renderPayload = {
            template_uuid: templateData.placid_template_uuid,
            layers: {
                "headline_news": { text: headline },
                "tag_news": { text: resolvedTag.toUpperCase() },
                "news-image": { image: bgImage }
            },
        };

        let placidImageUrl = "";
        try {
            const renderRes = await fetchWithTimeout("https://api.placid.app/api/rest/images", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${renderApiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(renderPayload),
                timeout: 8000
            });

            if (renderRes.ok) {
                const data = await renderRes.json();
                placidImageUrl = data.image_url;
                const pollingUrl = data.polling_url;

                if (!placidImageUrl && pollingUrl) {
                    for (let i = 0; i < 6; i++) {
                        await new Promise(r => setTimeout(r, 2000));
                        const pollRes = await fetch(pollingUrl, { headers: { "Authorization": `Bearer ${renderApiKey}` } });
                        if (pollRes.ok) {
                            const pollData = await pollRes.json();
                            if (pollData.status === "finished" && pollData.image_url) {
                                placidImageUrl = pollData.image_url;
                                break;
                            }
                        }
                    }
                }
            } else {
                const errtxt = await renderRes.text();
                return failProcess(`Placid API Erro: ${errtxt}`);
            }
        } catch (e) {
            console.error("[ap-employee-generator] Render Error:", e);
            return failProcess("Erro de timeout na renderização de Imagem.");
        }

        // 6. Atualizar status e URL da Imagem 
        const { error: finalUpdErr } = await supabase.schema("ap").from("candidate_news")
            .update({
                status: "ready_to_publish",
                render_url: placidImageUrl,
                headline: headline,
                caption: caption,
                categoria: resolvedTag,
                context_tag: resolvedTag
            })
            .eq("id", newsId);

        if (finalUpdErr) {
            console.error("[ap-employee-generator] Final update erro:", finalUpdErr);
        }

        // 7. Retornar payload síncrono para o cliente final
        return new Response(JSON.stringify({
            success: true,
            news_id: newsId,
            render_url: placidImageUrl,
            caption: caption,
            headline: headline,
            template_nome: templateData.nome
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (error) {
        console.error("[ap-employee-generator] Global Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
    }
});
