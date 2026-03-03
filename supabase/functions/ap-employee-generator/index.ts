// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Employee Generator Worker
// Fluxo síncrono: Reserva template via Fila Global, processa IA, renderiza no Placid e retorna.
// verify_jwt: false
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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
        const { titulo, conteudo, imagem_url, empresa_id, auth_user_id, context_tag, url_original, content_type = 'feed' } = body;

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
        // IMPORTANT: get_and_advance_template lives in the 'ap' schema, must use schema('ap').rpc()
        const { data: templateData, error: rpcError } = await supabase.schema("ap").rpc("get_and_advance_template", {
            p_empresa_id: empresa_id,
            p_tipo: content_type
        });

        if (rpcError || !templateData) {
            console.error("[ap-employee-generator] Falha ao recuperar/avançar template:", rpcError);
            return new Response(JSON.stringify({ error: "Fila de Templates vazia ou erro: " + (rpcError?.message || 'Nenhum template ativo do tipo solicitado') }), { status: 400, headers: corsHeaders });
        }

        console.log(`[ap-employee-generator] Template Reservado: ${templateData.nome} (Ordem: ${templateData.ordem}, Tipo: ${content_type})`);

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
            console.error("[ap-employee-generator] Falha ao criar registro news:", insertError);
            return new Response(JSON.stringify({ error: "Erro de Banco de Dados: " + insertError?.message }), { status: 400, headers: corsHeaders });
        }

        const newsId = newsItem.id;

        const failProcess = async (msg: string) => {
            await supabase.schema("ap").from("candidate_news")
                .update({ status: "failed", caption: msg })
                .eq("id", newsId);
            return new Response(JSON.stringify({ error: msg }), { status: 400, headers: corsHeaders });
        };

        // 3. Build prompt inline (NOT using buildEditorialPrompt — it appends a conflicting JSON schema)
        const safeTitulo = (titulo || "Pauta OMNI").slice(0, 500);
        const safeConteudo = (conteudo || "").slice(0, 3000);
        const safeTag = (context_tag || "DESTAQUE").toUpperCase();

        const inputBlock = `\n\nCONTEÚDO DA NOTÍCIA:\nTítulo: ${safeTitulo}\nCategoria: ${safeTag}\nURL Fonte: ${url_original || "N/A"}\nConteúdo:\n${safeConteudo || "Apenas título disponível."}`;

        let systemStr = "";
        let strictJsonStr = "";

        const strictFormattingNorms = `
\n\n============================================================
NORMAS TÉCNICAS SUPREMAS (ANULAM QUALQUER INSTRUÇÃO ANTERIOR):
============================================================

1. HEADLINE (O TÍTULO DO CARD):
- Deve ter NO MÁXIMO 3 LINHAS densas e informativas.
- Mínimo 50 caracteres, máximo 150.
- Não seja econômico. Use conectivos e detalhes para preencher as 3 linhas.
- OBRIGATÓRIO: Use quebras de linha naturais (caractere \\n no JSON) para separar as 3 linhas. NÃO USE barras "/" ou qualquer outro marcador.
- EXEMPLO DE DENSIDADE (FAÇA ASSIM):
  "ESTADO DE EMERGÊNCIA:\\nGOVÊRNO CONFIRMA NOVAS MEDIDAS\\nPARA ENFRENTAR CRISE DE SAÚDE"

2. TAG (A CATEGORIA DO TOPO):
- Use APENAS UMA palavra da lista fixa: [Cinema, Esportes, Política, Saúde, Tecnologia, Geral, Justiça, Famosos, Economia, Goiás].
- PROIBIÇÃO CRÍTICA: Nunca use nomes de pessoas (ex: Virginia, Vini Jr) ou marcas neste campo.

3. LEGENDA / CAPTION (O TEXTO DO POST):
- Deve ser TEXTO LIMPO para redes sociais (Emojis e Hashtags liberados).
- PROIBIÇÃO ABSOLUTA (NEGATIVE CONSTRAINT): Não use NENHUMA marcação técnica de roteiro ou script como [CENA], [GANCHO], [FALA], [CORTE], [ROTEIRO], [NARRAÇÃO], [VÍDEO], [IMAGEM], [BACKGROUND], etc.
- O campo "legenda" (ou "caption") deve ser pronto para leitura, sem instruções de produção.

4. ROTEIRO (APENAS PARA REELS):
- O campo "roteiro" deve conter o roteiro técnico completo SEPARADO da legenda. Nunca misture marcações de script no campo "legenda".
============================================================\n`;

        if (content_type === 'reels') {
            systemStr = "Você é um Editor Jornalístico Sênior para Redes Sociais. Transforme a notícia em um conteúdo atraente para vídeo, mas com rigor informativo.";
            strictJsonStr = `\nRetorne um JSON puro com: "headline", "tag", "legenda", "roteiro".\n${strictFormattingNorms}`;
        } else {
            systemStr = "Você é um Editor Jornalístico Sênior para Redes Sociais. Gere um texto direto e jornalístico.";
            strictJsonStr = `\nRetorne um JSON puro com: "headline", "caption", "tag".\n${strictFormattingNorms}`;
        }


        // 4. Configuração de IA — Integradada ao Motor Editorial
        let baseUrl = "https://api.anthropic.com";
        let model = "claude-3-5-sonnet-20240620"; // Default
        let temperature = 0.7;

        try {
            const [settingsRes, humanizationRes, promptRes, rulesRes] = await Promise.all([
                supabase.schema('ap').from('editorial_settings').select('*').eq('cliente_id', empresa_id).maybeSingle(),
                supabase.schema('ap').from('editorial_humanization').select('*').eq('cliente_id', empresa_id).maybeSingle(),
                supabase.schema('ap').from('editorial_prompt_versions').select('prompt_base').eq('cliente_id', empresa_id).eq('is_active', true).maybeSingle(),
                supabase.schema('ap').from('editorial_rules').select('*').eq('cliente_id', empresa_id)
            ]);

            const edSettings = settingsRes.data;
            const edHumanization = humanizationRes.data;
            const edPrompt = promptRes.data;
            const edRules = rulesRes.data || [];

            if (edSettings) {
                baseUrl = edSettings.api_base_url || baseUrl;
                model = edSettings.model_primary || model;
                temperature = edSettings.temperature ?? temperature;
            }

            // Determine the base system prompt from Editorial Engine
            let baseSystemPrompt = "";
            if (edSettings?.system_prompt_override && edSettings.override_prompt_text) {
                baseSystemPrompt = edSettings.override_prompt_text;
                console.log("[ap-employee-generator] Using Override Prompt from Editorial Engine.");
            } else if (edPrompt?.prompt_base) {
                baseSystemPrompt = edPrompt.prompt_base;
                console.log("[ap-employee-generator] Using Versioned Prompt from Editorial Engine.");
            } else {
                baseSystemPrompt = systemStr;
                console.log("[ap-employee-generator] Using Hardcoded Fallback Prompt.");
            }

            // Build additional editorial instructions
            let editorialInstructions = "";
            if (edRules.length > 0) {
                editorialInstructions += "\n\nREGRAS EDITORIAIS INEGOCIÁVEIS:\n";
                edRules.forEach((r: any) => {
                    if (r.rule_type === 'forbidden') editorialInstructions += `- PROIBIDO usar o termo: "${r.value}"\n`;
                    if (r.rule_type === 'mandatory') editorialInstructions += `- OBRIGATÓRIO incluir/considerar o termo: "${r.value}"\n`;
                    if (r.rule_type === 'substitution') editorialInstructions += `- SUBSTITUIR "${r.value.split('->')[0].trim()}" por "${r.value.split('->')[1]?.trim() || ''}"\n`;
                });
            }

            if (edHumanization) {
                editorialInstructions += `\nESTILO E HUMANIZAÇÃO:\n- Nível de Formalidade: ${edHumanization.formality_level}% (0=muito informal, 100=muito formal)\n- Criatividade: ${edHumanization.creativity_level}% (0=fatos secos, 100=metáforas ricas)\n- Densidade Técnica: ${edHumanization.technical_level}% (0=leigo, 100=especializado)\n`;
                if (edHumanization.anti_ai_variation) {
                    editorialInstructions += "- OBRIGATÓRIO: Evite clichês de IA como 'mergulhe fundo', 'em resumo', 'é importante ressaltar'. Use linguagem humana e direta.\n";
                }
            }

            const finalSystemStr = baseSystemPrompt + editorialInstructions;
            const finalPromptBase = finalSystemStr + inputBlock + strictJsonStr;

            // 5. API Key handling
            const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
            const oaiKey = anthropicKey;

            console.log("[ap-employee-generator] Using model:", model, "Temperature:", temperature);

            if (!oaiKey) {
                return failProcess("ANTHROPIC_API_KEY não configurada nos secrets da Edge Function.");
            }

            // 5. Chamar IA com retry
            let parsedData: any = null;
            let finalErrorMsg = "";
            const maxAttempts = 2;

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                try {
                    const retryAppend = attempt > 0 ? "\n\nO RETORNO ANTERIOR FOI INVÁLIDO. Retorne APENAS um objeto JSON puro, sem textos adicionais. Comece com '{' e termine com '}'." : "";
                    const finalPrompt = finalPromptBase + retryAppend;

                    console.log(`[ap-employee-generator] Tentativa ${attempt + 1}: model=${model}`);

                    const { content } = await callLLM({
                        apiKey: oaiKey,
                        baseUrl: baseUrl,
                        model: model,
                        prompt: finalPrompt,
                        temperature: temperature,
                        maxTokens: 1100
                    });

                    // Strip markdown wrappers
                    let jsonContent = content;
                    const xmlMatch = jsonContent.match(/<json>([\s\S]*?)<\/json>/);
                    if (xmlMatch) jsonContent = xmlMatch[1];
                    jsonContent = jsonContent.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();

                    // Extract first JSON object if there's extra text around it
                    const jsonStart = jsonContent.indexOf('{');
                    const jsonEnd = jsonContent.lastIndexOf('}');
                    if (jsonStart !== -1 && jsonEnd !== -1) {
                        jsonContent = jsonContent.slice(jsonStart, jsonEnd + 1);
                    }

                    parsedData = JSON.parse(jsonContent);

                    // Validation
                    if (!parsedData.headline || typeof parsedData.headline !== 'string' || parsedData.headline.length < 3) {
                        throw new Error("Invalid 'headline'.");
                    }
                    if (content_type === 'feed') {
                        if (!parsedData.caption || typeof parsedData.caption !== 'string' || parsedData.caption.length < 10) {
                            throw new Error("Invalid 'caption' for feed.");
                        }
                    } else {
                        if (!parsedData.legenda || typeof parsedData.legenda !== 'string' || parsedData.legenda.length < 10) {
                            throw new Error("Invalid 'legenda' for reels.");
                        }
                    }
                    break; // Success
                } catch (e: any) {
                    console.error(`[ap-employee-generator] Attempt ${attempt + 1} failed:`, e.message);
                    finalErrorMsg = e.message || "Parse error";
                    parsedData = null;
                }
            }

            if (!parsedData) {
                return failProcess(`Falha na geração de IA após ${maxAttempts} tentativas. Detalhe: ${finalErrorMsg}`);
            }

            const resolvedTag = parsedData.tag || safeTag;
            const headline = parsedData.headline || safeTitulo;

            let finalCaption = "";
            let finalRoteiro: string | null = null;

            if (content_type === 'feed') {
                finalCaption = parsedData.caption || safeTitulo;
            } else {
                finalCaption = parsedData.legenda || "";
                finalRoteiro = parsedData.roteiro || "";
            }

            // 6. Prevent empty render
            if (!headline?.trim() || !finalCaption?.trim()) {
                await supabase.schema("ap").from("candidate_news")
                    .update({ status: "failed_generation", headline, caption: finalCaption, categoria: resolvedTag })
                    .eq("id", newsId);
                return failProcess("Conteúdo vazio após geração de IA. Abortando renderização.");
            }

            // 7. Montar layers do Placid
            const bgImage = imagem_url || "https://images.unsplash.com/photo-1504711434969-e33886168f5c?q=80&w=1000&auto=format&fit=crop";
            const layers: any = {
                "headline_news": { text: headline },
                "tag_news": { text: resolvedTag.toUpperCase() }
            };
            if (content_type === 'feed') {
                layers["news-image"] = { image: bgImage };
            }

            // 8. Renderizar no Placid
            const renderPayload = {
                template_uuid: templateData.placid_template_uuid,
                layers: layers,
                create_config: {
                    image_format: "png",
                    image_quality: 95
                }
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
                    placidImageUrl = data.image_url || "";
                    const pollingUrl = data.polling_url;

                    // Reels rendering takes longer → more polling attempts with longer intervals
                    const maxPolls = content_type === 'reels' ? 10 : 6;
                    const pollInterval = content_type === 'reels' ? 3000 : 2000;

                    if (!placidImageUrl && pollingUrl) {
                        console.log(`[ap-employee-generator] Placid queued, polling up to ${maxPolls}x${pollInterval}ms...`);
                        for (let i = 0; i < maxPolls; i++) {
                            await new Promise(r => setTimeout(r, pollInterval));
                            const pollRes = await fetch(pollingUrl, { headers: { "Authorization": `Bearer ${renderApiKey}` } });
                            if (pollRes.ok) {
                                const pollData = await pollRes.json();
                                console.log(`[ap-employee-generator] Poll ${i + 1}/${maxPolls}: status=${pollData.status}`);
                                if (pollData.status === "finished" && pollData.image_url) {
                                    placidImageUrl = pollData.image_url;
                                    break;
                                }
                            }
                        }
                    }

                    // If still empty after all polls → fail explicitly (never leave status='processing')
                    if (!placidImageUrl) {
                        console.error("[ap-employee-generator] Placid image not ready after polling. Marking as failed.");
                        return failProcess("Renderização no Placid não concluída no tempo limite. Tente novamente.");
                    }
                } else {
                    const errtxt = await renderRes.text();
                    console.error("[ap-employee-generator] Placid error:", errtxt);
                    return failProcess(`Placid API Erro: ${errtxt}`);
                }
            } catch (e) {
                console.error("[ap-employee-generator] Render timeout:", e);
                return failProcess("Erro de timeout na renderização.");
            }

            // 9. Update final status
            // NOTE: `categoria` has CHECK constraint ['regional','nacional_relevante','engajamento_alto','global_contextual']
            // so the AI-generated tag is stored only in `context_tag`, never in `categoria`.
            const updPayload: any = {
                status: "ready_to_publish",
                render_url: placidImageUrl,
                headline: headline,
                context_tag: resolvedTag
            };

            if (content_type === 'reels') {
                updPayload.caption = finalCaption;
            } else {
                updPayload.caption = finalCaption;
            }

            const { error: finalUpdErr } = await supabase.schema("ap").from("candidate_news")
                .update(updPayload)
                .eq("id", newsId);

            if (finalUpdErr) {
                // Throw so the global catch handles it and the status doesn't stay 'processing'
                console.error("[ap-employee-generator] Final update error:", finalUpdErr);
                throw new Error(`Falha ao salvar resultado: ${finalUpdErr.message}`);
            }

            // 10. Return
            return new Response(JSON.stringify({
                success: true,
                news_id: newsId,
                render_url: placidImageUrl,
                caption: finalCaption,
                roteiro: finalRoteiro,
                headline: headline,
                template_nome: templateData.nome,
                content_type: content_type
            }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

        } catch (error: any) {
            console.error("[ap-employee-generator] Generation Error:", error);
            return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
        }
    } catch (error: any) {
        console.error("[ap-employee-generator] Global Error:", error);
        return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
    }
});
