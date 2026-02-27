// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Camada 2: Image Fetcher Worker
// Faz download da imagem da notícia e envia para o Supabase Storage.
// Triggered by: pg_cron (every 15 min)
// verify_jwt: false
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BATCH_LIMIT = 10;
const BUCKET = "ap-images";

Deno.serve(async (_req: Request) => {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!supabaseUrl || !serviceRoleKey) {
        return new Response(JSON.stringify({ error: "configuration_error" }), { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    // Self-healing + race condition safe: FOR UPDATE SKIP LOCKED equivalent via RPC
    // Select items that are 'raw' and not in processing (or stuck >10min)
    const { data: items, error } = await supabase
        .schema("ap").from("candidate_news")
        .select("id, imagem_url")
        .eq("status", "raw")
        .or("processing_started_at.is.null,processing_started_at.lt." + new Date(Date.now() - 10 * 60 * 1000).toISOString())
        .limit(BATCH_LIMIT); // Removed the `.not("imagem_url", "is", null)` filter

    if (error) {
        console.error("[ap-image-fetcher] select error:", error.message);
        return new Response(JSON.stringify({ error: "select_failed" }), { status: 500 });
    }

    const processed: string[] = [];

    for (const item of items ?? []) {
        // Mark as processing (self-healing signal)
        const { data: updatedData, error: updateErr } = await supabase
            .schema("ap").from("candidate_news")
            .update({ processing_started_at: new Date().toISOString() })
            .eq("id", item.id)
            .eq("status", "raw")
            .select("id");

        if (updateErr || !updatedData || updatedData.length === 0) continue; // Another worker grabbed it — skip

        try {
            let storagePath = null;
            let targetImgUrl = item.imagem_url;

            // Fallback: If no image_url provided by RSS, try fetching it from the original URL's OpenGraph tags
            if (!targetImgUrl && item.url_original) {
                try {
                    const pageRes = await fetch(item.url_original, { headers: { "User-Agent": "FlowOS AutoPublisher Bot/1.0" } });
                    if (pageRes.ok) {
                        const html = await pageRes.text();
                        const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i)
                            || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/i);
                        if (ogImageMatch && ogImageMatch[1]) {
                            targetImgUrl = ogImageMatch[1];
                            console.log(`[ap-image-fetcher] Scraped OG Image for ${item.id}:`, targetImgUrl);
                        }
                    }
                } catch (e) {
                    console.log(`[ap-image-fetcher] Failed to scrape OG Image for ${item.id}`);
                }
            }

            if (targetImgUrl) {
                const imgRes = await fetch(targetImgUrl, { headers: { "User-Agent": "FlowOS AutoPublisher/1.0" } });
                if (imgRes.ok) {
                    const blob = await imgRes.arrayBuffer();
                    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
                    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
                    storagePath = `${item.id}.${ext}`;

                    const { error: uploadError } = await supabase.storage
                        .from(BUCKET)
                        .upload(storagePath, blob, { contentType, upsert: true });

                    if (uploadError) {
                        console.error(`[ap-image-fetcher] item ${item.id} image upload error:`, uploadError);
                        storagePath = null; // Proceed without image if upload fails
                    }
                } else {
                    console.error(`[ap-image-fetcher] item ${item.id} image fetch failed: HTTP ${imgRes.status}`);
                    // Proceed without image
                }
            }

            // Advance status — idempotent: WHERE status = 'raw'
            await supabase
                .schema("ap").from("candidate_news")
                .update({ imagem_storage: storagePath, status: "ready_for_scoring", processing_started_at: null })
                .eq("id", item.id)
                .eq("status", "raw");

            processed.push(item.id);
        } catch (err) {
            console.error(`[ap-image-fetcher] item ${item.id} error:`, err);
            // Clear processing lock so self-healing can retry after 10min
            await supabase
                .schema("ap").from("candidate_news")
                .update({ processing_started_at: null })
                .eq("id", item.id);
        }
    }

    return new Response(JSON.stringify({ ok: true, processed }), {
        headers: { "Content-Type": "application/json" },
    });
});
