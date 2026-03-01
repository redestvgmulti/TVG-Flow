// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Motor de Integração do Estúdio (ap-send-to-studio)
// Envia roteiro_studio para um servidor externo SMB/WebDAV ou FTP via API.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
    // 1. CORS Preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { newsId } = await req.json();

        if (!newsId) {
            return new Response(JSON.stringify({ error: "Missing newsId" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const supabase = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
            { auth: { autoRefreshToken: false, persistSession: false } }
        );

        // Fetch roteiro
        const { data: newsItem, error: fetchErr } = await supabase
            .schema("ap").from("candidate_news")
            .select("id, titulo, roteiro_studio, enviado_para_studio, status, studio_media_image_url, studio_media_video_url")
            .eq("id", newsId)
            .single();

        if (fetchErr || !newsItem) {
            throw new Error("News item not found or DB error");
        }

        if (newsItem.enviado_para_studio) {
            return new Response(JSON.stringify({ message: "Item já foi enviado para o estúdio.", skipped: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        if (!newsItem.roteiro_studio) {
            throw new Error("Nenhum roteiro encontrado para enviar. Certifique-se de que a IA processou a pauta.");
        }

        // 1) Gerar arquivo .txt em memória
        const txtContent = `TÍTULO: ${newsItem.titulo}\n\nROTEIRO TELEPROMPTER:\n${newsItem.roteiro_studio}\n\n[ATENÇÃO EDITOR DE VÍDEO]\nAssets Vinculados:\nVídeo: ${newsItem.studio_media_video_url || "N/A"}\nImagem: ${newsItem.studio_media_image_url || "N/A"}`;

        // 2) Chamar função abstrata de upload (Simulação)
        console.log(`[ap-send-to-studio] Iniciando transferência para Synology...`);
        const uploadSuccess = await uploadToStudioServer(newsId, txtContent);

        if (!uploadSuccess) {
            throw new Error("Falha ao comunicar com servidor de Estudio SMB/REST.");
        }

        // 3) Atualizar status
        const { error: updateErr } = await supabase
            .schema("ap").from("candidate_news")
            .update({
                enviado_para_studio: true,
                status: "studio_ready"
            })
            .eq("id", newsId);

        if (updateErr) throw new Error("Erro ao salvar status de envio no DB: " + updateErr.message);

        return new Response(JSON.stringify({ ok: true, message: "Enviado com sucesso!" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

    } catch (error: any) {
        console.error("[ap-send-to-studio] Falha crítica:", error);
        return new Response(JSON.stringify({ error: error.message || "Erro desconhecido" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});

// 📌 Função Assíncrona Abstrata de Integração Direta (Synology / SMB)
async function uploadToStudioServer(newsId: string, contentTxt: string): Promise<boolean> {
    try {
        // [SIMULAÇÃO DE REDE] - TODO: Substituir por um const client = new SmbClient(...) ou req a API do Synology NAS
        console.log(`[uploadToStudioServer] Gerando news_${newsId}.txt...`);
        console.log(`[uploadToStudioServer] Conteúdo: ${contentTxt.substring(0, 50)}...`);

        await new Promise(resolve => setTimeout(resolve, 800)); // Simulando latência de 800ms

        console.log(`[uploadToStudioServer] Transferência de Roteiro Concluída UUID: ${newsId}`);
        return true;
    } catch (e) {
        console.error("[uploadToStudioServer] Erro na rede interna:", e);
        return false;
    }
}
