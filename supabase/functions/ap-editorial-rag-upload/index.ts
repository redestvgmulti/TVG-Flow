// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Motor Editorial: RAG Knowledge Base Uploader
// MODE: SINGLE-TENANT (TVG only)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode, decode } from "npm:gpt-tokenizer";

const FIXED_CLIENT_ID = "cd287e6e-f273-4d0f-a72d-2a8c391e40e9";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
};

const CHUNK_SIZE = 800;
const OVERLAP = 100;

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const clienteId = FIXED_CLIENT_ID;

        const sbAdmin = createClient(supabaseUrl, supabaseServiceRole);

        // ================= GET: Listar documentos =================
        if (req.method === "GET") {
            const { data: docs } = await sbAdmin
                .schema("ap")
                .from("editorial_rag_documents")
                .select("source_document_id, file_name, created_at, chunk_count")
                .eq("cliente_id", clienteId)
                .order("created_at", { ascending: false });

            const unique = docs ? Object.values(
                docs.reduce((acc: Record<string, unknown>, d: Record<string, unknown>) => {
                    if (!acc[d.source_document_id as string]) {
                        acc[d.source_document_id as string] = {
                            source_document_id: d.source_document_id,
                            file_name: d.file_name,
                            created_at: d.created_at,
                            chunk_count: d.chunk_count
                        };
                    }
                    return acc;
                }, {})
            ) : [];

            return new Response(JSON.stringify(unique), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        // Fetch Vault key para POST/DELETE
        const { data: settings } = await sbAdmin
            .schema("ap")
            .from("editorial_settings")
            .select("vault_secret_id, api_base_url")
            .eq("cliente_id", clienteId)
            .maybeSingle();

        if (!settings?.vault_secret_id) {
            throw new Error("OpenAI Key não configurada. Acesse o Motor Editorial e salve a API Key primeiro.");
        }

        const { data: vaultData } = await sbAdmin
            .from("vault.decrypted_secrets")
            .select("decrypted_secret")
            .eq("id", settings.vault_secret_id)
            .maybeSingle();

        const openaiKey = vaultData?.decrypted_secret;
        if (!openaiKey) throw new Error("Não foi possível descriptografar a OpenAI Key do Vault.");

        // ================= POST: Upload =================
        if (req.method === "POST") {
            const { file_name, content } = await req.json();
            if (!file_name || !content) throw new Error("Missing file_name or content");

            if (content.length > 1048576) {
                throw new Error("Tamanho máximo do documento excedido: 1MB.");
            }

            const { count: docsCount } = await sbAdmin
                .schema("ap")
                .from("editorial_rag_documents")
                .select("id", { count: "exact", head: true })
                .eq("cliente_id", clienteId);

            if (docsCount && docsCount >= 50) {
                throw new Error("Limite de 50 documentos RAG atingido.");
            }

            const tokens = encode(content);
            const chunks: string[] = [];

            if (tokens.length <= CHUNK_SIZE) {
                chunks.push(content);
            } else {
                for (let i = 0; i < tokens.length; i += (CHUNK_SIZE - OVERLAP)) {
                    chunks.push(decode(tokens.slice(i, i + CHUNK_SIZE)));
                }
            }

            const baseUrl = settings?.api_base_url || "https://api.openai.com/v1";

            if (baseUrl.includes("anthropic.com")) {
                throw new Error("O provedor Anthropic não suporta Embeddings nativamente. O recurso RAG está indisponível para esta API no momento.");
            }

            const embedRes = await fetch(`${baseUrl}/embeddings`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${openaiKey}`
                },
                body: JSON.stringify({ model: "text-embedding-3-small", input: chunks })
            });

            if (!embedRes.ok) {
                throw new Error("OpenAI Embeddings Failed: " + await embedRes.text());
            }

            const embedData = await embedRes.json();
            const sourceDocId = crypto.randomUUID();

            const insertPayload = chunks.map((chunkStr, index) => ({
                cliente_id: clienteId,
                file_name,
                source_document_id: sourceDocId,
                chunk_index: index,
                content: chunkStr,
                embedding: embedData.data[index].embedding
            }));

            const { error: insertErr } = await sbAdmin
                .schema("ap")
                .from("editorial_rag_documents")
                .insert(insertPayload);

            if (insertErr) throw insertErr;

            return new Response(JSON.stringify({ success: true, chunks_processed: chunks.length }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        // ================= DELETE =================
        if (req.method === "DELETE") {
            const body = await req.json().catch(() => ({}));
            const docId = body.source_document_id ?? new URL(req.url).searchParams.get("source_document_id");
            if (!docId) throw new Error("source_document_id required");

            await sbAdmin
                .schema("ap")
                .from("editorial_rag_documents")
                .delete()
                .eq("cliente_id", clienteId)
                .eq("source_document_id", docId);

            return new Response(JSON.stringify({ success: true }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    } catch (err: any) {
        console.error("RAG Err:", err);
        return new Response(JSON.stringify({ error: err.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
