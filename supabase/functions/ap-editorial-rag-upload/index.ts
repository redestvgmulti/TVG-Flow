// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Motor Editorial: RAG Knowledge Base Uploader
// Receives text content, chunks into 800 tokens, gets embeddings, saves via pgvector
// verify_jwt: true
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode, decode } from "npm:gpt-tokenizer";

const corsHeaders = {
    "Access-Control-Allow-Origin": "http://localhost:4173, https://flowos.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
};

const CHUNK_SIZE = 800;
const OVERLAP = 100;

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) throw new Error("Missing Authorization header");

        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
        const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: authHeader } },
        });

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) throw new Error("Unauthorized");

        let clienteId = null;
        let role = null;
        const { data: profData } = await supabase
            .from("cliente_profissionais")
            .select("cliente_id, role")
            .eq("profissional_id", user.id)
            .eq("ativo", true)
            .limit(1)
            .maybeSingle();

        if (!profData) throw new Error("User has no active tenant");
        clienteId = profData.cliente_id;
        role = profData.role;

        const sbAdmin = createClient(supabaseUrl, supabaseServiceRole);

        // Fetch Vault key proxy logic
        const { data: settings } = await sbAdmin
            .from("ap.editorial_settings")
            .select("vault_secret_id")
            .eq("cliente_id", clienteId)
            .maybeSingle();

        if (!settings || !settings.vault_secret_id) {
            throw new Error("Editorial Settings or OpenAI Key not configured for this tenant.");
        }

        const { data: secretData } = await sbAdmin.rpc("read_secret", {
            secret_id: settings.vault_secret_id,
        });

        // If we don't have Vault properly resolving read_secret, we might need a fallback.
        // Usually read_secret takes a name/uuid, let's assume it works.
        // Actually, Supabase vault `decrypted_secret` is accessed via the `vault.secrets` view if you have service role.
        let openaiKey = null;

        // Direct Query from vault schema (Requires Service Role)
        const { data: vaultData } = await sbAdmin.from('vault.decrypted_secrets')
            .select('decrypted_secret')
            .eq('id', settings.vault_secret_id)
            .maybeSingle();

        openaiKey = vaultData?.decrypted_secret;

        if (!openaiKey) throw new Error("Could not decrypt OpenAI Key from Vault.");

        if (req.method === "POST") {
            if (role !== "admin") {
                throw new Error("Ação não autorizada. Apenas administradores podem fazer upload de base de conhecimento.");
            }

            const { file_name, content } = await req.json();
            if (!file_name || !content) throw new Error("Missing file_name or content");

            // Hard Limits (Enterprise P1)
            // 1. Max size: 1MB (roughly 1 million chars)
            if (content.length > 1048576) {
                throw new Error("Limites excedidos: o tamanho máximo do documento é de 1MB.");
            }

            // 2. Max docs limit: 50
            const { count: docsCount } = await sbAdmin
                .from("ap.editorial_rag_documents")
                .select("id", { count: "exact", head: true })
                .eq("cliente_id", clienteId);

            if (docsCount && docsCount >= 50) {
                throw new Error("Limite empresarial alcançado: máximo de 50 documentos RAG por tenant.");
            }

            // Chunking strategy using gpt-tokenizer
            const tokens = encode(content);
            const chunks: string[] = [];

            if (tokens.length <= CHUNK_SIZE) {
                chunks.push(content);
            } else {
                for (let i = 0; i < tokens.length; i += (CHUNK_SIZE - OVERLAP)) {
                    chunks.push(decode(tokens.slice(i, i + CHUNK_SIZE)));
                }
            }

            // Get embeddings batch
            const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${openaiKey}`
                },
                body: JSON.stringify({
                    model: "text-embedding-3-small",
                    input: chunks
                })
            });

            if (!embedRes.ok) {
                let err = await embedRes.text();
                throw new Error("OpenAI Embeddings Failed: " + err);
            }

            const embedData = await embedRes.json();
            const sourceDocId = crypto.randomUUID();

            // Insert chunks into DB
            const insertPayload = chunks.map((chunkStr, index) => ({
                cliente_id: clienteId,
                file_name,
                source_document_id: sourceDocId,
                chunk_index: index,
                content: chunkStr,
                embedding: embedData.data[index].embedding
            }));

            const { error: insertErr } = await sbAdmin
                .from("ap.editorial_rag_documents")
                .insert(insertPayload);

            if (insertErr) throw insertErr;

            return new Response(JSON.stringify({ success: true, chunks_processed: chunks.length }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        // GET = list documents (grouped by source_document_id or just distinct file_names)
        if (req.method === "GET") {
            // we return distinct files
            const { data } = await sbAdmin
                .from("ap.editorial_rag_documents")
                .select("id, file_name, created_at, source_document_id")
                .eq("cliente_id", clienteId)
                .eq("chunk_index", 0) // only fetch roots for listing summary
                .order("created_at", { ascending: false });

            return new Response(JSON.stringify(data || []), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        // DELETE
        if (req.method === "DELETE") {
            if (role !== "admin") {
                throw new Error("Ação não autorizada. Apenas administradores podem excluir da base de conhecimento.");
            }

            const url = new URL(req.url);
            const docId = url.searchParams.get('source_document_id');
            if (!docId) throw new Error("docId required");

            await sbAdmin.from("ap.editorial_rag_documents")
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
