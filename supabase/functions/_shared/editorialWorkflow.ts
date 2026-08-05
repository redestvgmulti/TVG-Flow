// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Shared Editorial Workflow
// Centralizes LLM logic, prompt building, and human-input merging.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { buildEditorialPrompt, getEditorialContext, buildStudioPrompt } from "./editorialPromptBuilder.ts";
import { callLLM, logAIUsage, selectModel } from "./llmClient.ts";

declare const Deno: any;

export interface WorkflowOptions {
    newsId: string;
    clienteId: string;
    actionType?: "standard" | "process_studio" | "approve_for_ig";
    userHeadline?: string | null;
    userTag?: string | null;
    userText?: string | null;
    contentType?: "feed" | "reels" | "story";
}

export async function runEditorialWorkflow(supabase: SupabaseClient, options: WorkflowOptions) {
    const { newsId, clienteId, actionType = "standard", userHeadline, userTag, userText, contentType = "feed" } = options;

    console.log(`[WORKFLOW] [runEditorialWorkflow] Processing newsId=${newsId} for clienteId=${clienteId} (Action: ${actionType})`);

    // 1. Fetch Item Data (needed for fallback and context)
    const { data: item, error: fetchErr } = await supabase.schema("ap")
        .from("candidate_news")
        .select("titulo, conteudo, categoria, context_tag, url_original, headline, caption, status")
        .eq("id", newsId)
        .single();

    if (fetchErr || !item) {
        throw new Error(`Failed to fetch news item: ${fetchErr?.message || "Not found"}`);
    }

    // 2. Get Editorial Context
    const context = await getEditorialContext(supabase, clienteId, userText || item.conteudo || item.titulo || "");
    if (!context) {
        throw new Error("Editorial context not found for client: " + clienteId);
    }

    // 3. Resolve API Key
    let finalOpenAiKey = "";
    if (context.settings?.vault_secret_id) {
        const { data: secretData } = await supabase.rpc('get_decrypted_secret', { secret_id: context.settings.vault_secret_id });
        if (secretData) finalOpenAiKey = secretData;
    }
    if (!finalOpenAiKey) {
        finalOpenAiKey = Deno.env.get("ANTHROPIC_API_KEY") || Deno.env.get("OPENAI_API_KEY") || "";
    }
    if (!finalOpenAiKey) {
        throw new Error("Missing LLM API Key");
    }

    // 4. Build Prompt
    let prompt = "";
    if (actionType === "process_studio") {
        prompt = buildStudioPrompt({
            titulo: item.titulo,
            conteudo: item.conteudo,
            categoria: item.categoria,
            url_original: item.url_original,
            settings: context.settings,
            promptVersion: context.promptVersion,
            humanization: context.humanization,
            rules: context.rules,
            ragContext: context.ragContext,
            openaiKey: finalOpenAiKey
        });
    } else {
        prompt = await buildEditorialPrompt(supabase, {
            titulo: item.titulo,
            conteudo: item.conteudo,
            categoria: item.categoria,
            url_original: item.url_original,
            settings: context.settings,
            promptVersion: context.promptVersion,
            humanization: context.humanization,
            rules: context.rules,
            ragContext: context.ragContext,
            openaiKey: finalOpenAiKey,
            contentType: contentType as any,
            status: item.status,
            userHeadline,
            userTag,
            userText
        });
    }

    // 5. Call LLM
    const taskComplexity = actionType === "process_studio" ? "low-cost" : "high-quality";
    const model = selectModel(taskComplexity, context.settings?.model_primary);
    console.log(`[WORKFLOW] Calling LLM (${model}) for taskComplexity=${taskComplexity}...`);
    
    const { content, tokens } = await callLLM({
        apiKey: finalOpenAiKey,
        model: model,
        prompt: prompt,
        baseUrl: context.settings?.api_base_url || undefined,
        temperature: context.settings?.temperature || 0.7,
        maxTokens: actionType === "process_studio" ? 2000 : 1500
    });

    // 6. Log Usage (Audit)
    logAIUsage(model, tokens.prompt, tokens.completion, newsId);

    // 7. Parse AI Output
    let parsedData: any = {};
    try {
        const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) ||
            content.match(/```([\s\S]*?)```/) ||
            content.match(/(\{[\s\S]*\})/);
        const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
        parsedData = JSON.parse(jsonStr.trim());
    } catch (e) {
        console.warn("[WORKFLOW] JSON Parse failed - using raw output as fallback.", content.slice(0, 100));
    }

    // 8. Human Sovereignty & Merge
    let resultPayload: any = {};
    
    if (actionType === "process_studio") {
        resultPayload = {
            roteiro_studio: parsedData.roteiro_teleprompter || parsedData.roteiro_studio || content,
            duracao_estimada: parsedData.duracao_estimada_segundos || 60,
            broll_sugestao: parsedData.broll_sugestao || "N/A"
        };
    } else {
        const finalHeadline = userHeadline ?? parsedData.headline ?? item.headline ?? item.titulo ?? "Pauta OMNI";
        const finalTag = userTag ?? parsedData.context_tag ?? item.context_tag ?? "DESTAQUE";
        const finalCaption = (parsedData.caption || parsedData.legenda) ?? userText ?? item.caption ?? "";

        resultPayload = {
            headline: finalHeadline,
            caption: finalCaption,
            context_tag: finalTag,
            roteiro_json: parsedData.roteiro || null
        };
    }

    console.log(`[WORKFLOW] Workflow complete for newsId=${newsId}`);
    return resultPayload;
}
