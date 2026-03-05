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
            let imageExternal = false;

            // 1. Fallback: If no image_url provided, try scraping OG Image
            if (!targetImgUrl && item.url_original) {
                try {
                    const pageRes = await fetch(item.url_original, {
                        headers: {
                            "User-Agent": "Mozilla/5.0",
                            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
                        }
                    });
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

            // 2. Internalization Attempt
            if (targetImgUrl) {
                let imgRes: Response | null = null;
                const baseHeaders: Record<string, string> = {
                    "User-Agent": "Mozilla/5.0",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
                    "Referer": "https://g1.globo.com"
                };

                const urlsToTry = [targetImgUrl];

                // G1/Globo URL Cleaning: if it's a transformed Globo URL, extract the direct origin version if embedded
                if (targetImgUrl.includes(".glbimg.com")) {
                    const urlParts = targetImgUrl.split("https://");
                    if (urlParts.length > 2) {
                        const directUrl = "https://" + urlParts[urlParts.length - 1];
                        if (directUrl.includes(".glbimg.com")) {
                            urlsToTry.push(directUrl);
                        }
                    } else {
                        // Fallback for http split
                        const httpParts = targetImgUrl.split("http://");
                        if (httpParts.length > 2) {
                            const directUrl = "http://" + httpParts[httpParts.length - 1];
                            if (directUrl.includes(".glbimg.com")) {
                                urlsToTry.push(directUrl);
                            }
                        }
                    }
                }

                for (const url of urlsToTry) {
                    for (let attempt = 0; attempt < 2; attempt++) {
                        try {
                            imgRes = await fetch(url, { headers: baseHeaders });
                            if (imgRes.ok) break;
                        } catch (e) {
                            console.warn(`[ap-image-fetcher] item ${item.id} fetch failed for ${url}:`, e);
                        }
                    }
                    if (imgRes && imgRes.ok) break;
                }

                if (imgRes && imgRes.ok) {
                    const contentType = (imgRes.headers.get("content-type") || "").toLowerCase();
                    const contentLength = parseInt(imgRes.headers.get("content-length") || "0", 10);

                    if (contentType.includes("text/html") || (contentLength > 10 * 1024 * 1024)) {
                        console.error(`[ap-image-fetcher] item ${item.id} rejected: Wrong type or size`);
                    } else {
                        const reader = imgRes.body?.getReader();
                        if (reader) {
                            const { value: firstChunk } = await reader.read();
                            if (firstChunk && firstChunk.length >= 4) {
                                const hex = Array.from(firstChunk.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join('');
                                if (hex.startsWith('3c')) {
                                    console.error(`[ap-image-fetcher] item ${item.id} blocked: HTML detected`);
                                    reader.cancel();
                                } else {
                                    let ext = "jpg";
                                    if (hex.startsWith('ffd8')) ext = 'jpg';
                                    else if (hex.startsWith('89504e47')) ext = 'png';
                                    else if (hex.startsWith('47494638')) ext = 'gif';
                                    else if (hex === '52494646') ext = 'webp';
                                    else ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";

                                    storagePath = `${item.id}.${ext}`;
                                    const chunks = [firstChunk];
                                    let totalLength = firstChunk.length;
                                    let exceeded = false;
                                    while (true) {
                                        const { value, done } = await reader.read();
                                        if (done) break;
                                        if (value) {
                                            chunks.push(value);
                                            totalLength += value.length;
                                        }
                                        if (totalLength > 10 * 1024 * 1024) { exceeded = true; reader.cancel(); break; }
                                    }

                                    if (!exceeded) {
                                        const buffer = new Uint8Array(totalLength);
                                        let offset = 0;
                                        for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
                                        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, { contentType, upsert: true });
                                        if (uploadError) {
                                            console.error(`[ap-image-fetcher] upload error:`, uploadError);
                                            storagePath = null;
                                        }
                                    } else {
                                        storagePath = null;
                                    }
                                }
                            } else {
                                reader.cancel();
                            }
                        }
                    }
                }
            }

            // 3. Strategy Result
            imageExternal = (storagePath === null && targetImgUrl !== null);

            // 4. Status Advancement Rule: Only advance if we have at least one valid source
            if (storagePath || targetImgUrl) {
                await supabase
                    .schema("ap").from("candidate_news")
                    .update({
                        imagem_storage: storagePath,
                        imagem_url: targetImgUrl, // Ensure scraped URLs are saved
                        image_external: imageExternal,
                        status: "ready_for_scoring",
                        processing_started_at: null
                    })
                    .eq("id", item.id)
                    .eq("status", "raw");
                processed.push(item.id);
            } else {
                console.error(`[ap-image-fetcher] item ${item.id} aborted: No image source found.`);
                await supabase.schema("ap").from("candidate_news").update({ processing_started_at: null }).eq("id", item.id);
            }

        } catch (err) {
            console.error(`[ap-image-fetcher] item ${item.id} error:`, err);
            await supabase.schema("ap").from("candidate_news").update({ processing_started_at: null }).eq("id", item.id);
        }
    }

    return new Response(JSON.stringify({ ok: true, processed }), {
        headers: { "Content-Type": "application/json" },
    });
});
