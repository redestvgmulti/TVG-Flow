// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Camada 7: Content Production Worker
// Gera headline, caption e roteiro_json via OpenAI GPT-4o-mini.
// Triggered by: pg_cron (every 20 min)
// verify_jwt: false
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BATCH_LIMIT = 5; // AI calls are expensive — smaller batch
const OPENAI_MODEL = "gpt-4o-mini";

Deno.serve(async (_req: Request) => {
    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
        return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), { status: 500 });
    }

    // Only items that are 'selected' AND have no headline yet (idempotent guard)
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: items } = await supabase
        .from("ap.candidate_news")
        .select("id, titulo, conteudo, categoria")
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
            const prompt = buildPrompt(item.titulo, item.conteudo, item.categoria);
            const aiResponse = await callOpenAI(openaiKey, prompt);
            const parsed = parseAiOutput(aiResponse);

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

function buildPrompt(titulo: string, conteudo: string | null, categoria: string | null): string {
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

async function callOpenAI(apiKey: string, prompt: string): Promise<string> {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model: OPENAI_MODEL,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            max_tokens: 400,
        }),
    });
    if (!res.ok) throw new Error(`OpenAI error: ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
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
