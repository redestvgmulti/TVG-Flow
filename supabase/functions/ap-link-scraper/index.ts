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

        // 4. Extrair Imagem
        let image_url = $('meta[property="og:image"]').attr('content') ||
            $('meta[name="twitter:image"]').attr('content') ||
            $('article img').first().attr('src');

        // Se a imagem for caminho relativo, converter para absoluto
        if (image_url && image_url.startsWith('/')) {
            const urlObj = new URL(url);
            image_url = `${urlObj.protocol}//${urlObj.host}${image_url}`;
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
            content: content?.trim() || ""
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
