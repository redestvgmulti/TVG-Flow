import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";

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
        const { url } = await req.json();
        console.log(`[AUDIT] [ap-link-scraper] Scraping URL: ${url}`);

        if (!url) {
            return new Response(JSON.stringify({ error: "URL é obrigatória" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // 2. Fetch HTML
        const res = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
            }
        });

        if (!res.ok) {
            throw new Error(`Falha ao acessar o link (HTTP ${res.status})`);
        }

        const html = await res.text();
        const $ = cheerio.load(html);

        // 3. Extrair Título
        let title = $('meta[property="og:title"]').attr('content') ||
            $('title').text() ||
            $('h1').first().text();

        // 4. Extrair Imagem e Vídeo
        let image_url = $('meta[property="og:image"]').attr('content') ||
            $('meta[name="twitter:image"]').attr('content') ||
            $('article img').first().attr('src');

        let video_url = $('meta[property="og:video"]').attr('content') ||
            $('meta[property="og:video:url"]').attr('content') ||
            $('meta[property="og:video:secure_url"]').attr('content') || null;

        // Se a imagem ou vídeo for caminho relativo, converter para absoluto
        if (image_url && image_url.startsWith('/')) {
            const urlObj = new URL(url);
            image_url = `${urlObj.protocol}//${urlObj.host}${image_url}`;
        }
        if (video_url && video_url.startsWith('/')) {
            const urlObj = new URL(url);
            video_url = `${urlObj.protocol}//${urlObj.host}${video_url}`;
        }

        // 5. Extrair Conteúdo (Priorizar article, main, ou body)
        let content = '';
        const articleNode = $('article').length > 0 ? $('article') :
            ($('main').length > 0 ? $('main') : $('body'));

        // Pegar todos os parágrafos relevantes
        articleNode.find('p').each((_, el) => {
            const text = $(el).text().trim();
            // Ignorar parágrafos muito curtos que geralmente são lixo de navegação
            if (text.length > 30) {
                content += text + '\n\n';
            }
        });

        // Fallback para description
        if (!content || content.trim().length < 50) {
            content = $('meta[property="og:description"]').attr('content') ||
                $('meta[name="description"]').attr('content') ||
                '';
        }

        return new Response(JSON.stringify({
            title: title?.trim() || "",
            image_url: image_url?.trim() || "",
            content: content?.trim() || "",
            studio_media_image_url: image_url?.trim() || "",
            studio_media_video_url: video_url?.trim() || null
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

    } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message || "Erro desconhecido ao processar link" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
