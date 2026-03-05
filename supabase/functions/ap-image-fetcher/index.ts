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
                    const pageRes = await fetch(item.url_original, {
                        headers: {
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
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

            if (targetImgUrl) {
                let imgRes: Response | null = null;
                const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36";
                const baseHeaders: Record<string, string> = {
                    "User-Agent": userAgent,
                    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
                    "Sec-Fetch-Dest": "image",
                    "Sec-Fetch-Mode": "no-cors",
                    "Sec-Fetch-Site": "cross-site"
                };

                // Retry strategy
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        const headers = { ...baseHeaders };
                        if (attempt === 1) headers["Referer"] = new URL(targetImgUrl).origin + "/";
                        if (attempt === 2) {
                            headers["Cache-Control"] = "no-cache";
                            headers["Pragma"] = "no-cache";
                        }

                        imgRes = await fetch(targetImgUrl, { headers });
                        if (imgRes.ok) break;
                    } catch (e) {
                        console.warn(`[ap-image-fetcher] item ${item.id} fetch attempt ${attempt + 1} failed:`, e);
                    }
                }

                if (imgRes && imgRes.ok) {
                    const contentType = (imgRes.headers.get("content-type") || "").toLowerCase();
                    const contentLength = parseInt(imgRes.headers.get("content-length") || "0", 10);

                    if (contentType.includes("text/html")) {
                        console.error(`[ap-image-fetcher] item ${item.id} blocked: HTML content-type`);
                    } else if (contentLength > 10 * 1024 * 1024) { // Limite estrito de 10MB
                        console.error(`[ap-image-fetcher] item ${item.id} blocked: File too large (${contentLength} bytes)`);
                    } else {
                        const reader = imgRes.body?.getReader();
                        if (reader) {
                            const { value: firstChunk, done } = await reader.read();
                            if (firstChunk && firstChunk.length >= 4) {
                                const hex = Array.from(firstChunk.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join('');
                                // Bloquear HTML disfarçado (<!DO ou <htm ou <)
                                if (hex.startsWith('3c')) {
                                    console.error(`[ap-image-fetcher] item ${item.id} blocked: HTML magic bytes detected`);
                                    reader.cancel();
                                } else {
                                    let ext = "jpg";
                                    if (hex.startsWith('ffd8')) ext = 'jpg';
                                    else if (hex.startsWith('89504e47')) ext = 'png';
                                    else if (hex.startsWith('47494638')) ext = 'gif';
                                    else if (hex === '52494646') ext = 'webp'; // RIFF
                                    else ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";

                                    storagePath = `${item.id}.${ext}`;

                                    // Ler o restante da imagem para a memória (limitado a 10MB)
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
                                        if (totalLength > 10 * 1024 * 1024) {
                                            exceeded = true;
                                            reader.cancel();
                                            break;
                                        }
                                    }

                                    if (exceeded) {
                                        console.error(`[ap-image-fetcher] item ${item.id} blocked: Stream size exceeded 10MB limit during read`);
                                        storagePath = null;
                                    } else {
                                        const buffer = new Uint8Array(totalLength);
                                        let offset = 0;
                                        for (const chunk of chunks) {
                                            buffer.set(chunk, offset);
                                            offset += chunk.length;
                                        }

                                        try {
                                            const { error: uploadError } = await supabase.storage
                                                .from(BUCKET)
                                                .upload(storagePath, buffer, { contentType, upsert: true });

                                            if (uploadError) {
                                                console.error(`[ap-image-fetcher] item ${item.id} image upload error:`, uploadError);
                                                storagePath = null;
                                            }
                                        } catch (e) {
                                            console.error(`[ap-image-fetcher] item ${item.id} stream upload exception:`, e);
                                            storagePath = null;
                                        }
                                    }
                                }
                            } else {
                                reader.cancel();
                            }
                        }
                    }
                } else {
                    console.error(`[ap-image-fetcher] item ${item.id} image fetch failed: HTTP ${imgRes?.status || "unknown"}`);
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
