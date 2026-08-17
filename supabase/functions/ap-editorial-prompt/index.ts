// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Motor Editorial: Prompt Versioning API
// MODE: SINGLE-TENANT (TVG only)
// POST: create new version and deactivate old
// GET: list history
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { EditorialAdminAuthorizationError, requireEditorialAdmin } from "../_shared/editorialAdminAuth.ts";

const FIXED_CLIENT_ID = "cd287e6e-f273-4d0f-a72d-2a8c391e40e9";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const clienteId = FIXED_CLIENT_ID;

        const sbAdmin = createClient(supabaseUrl, supabaseServiceRole);
        await requireEditorialAdmin(req, sbAdmin, clienteId);

        if (req.method === "GET") {
            const { data: history } = await sbAdmin
                .schema("ap")
                .from("editorial_prompt_versions")
                .select("*")
                .eq("cliente_id", clienteId)
                .order("version_number", { ascending: false });

            return new Response(JSON.stringify(history || []), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        if (req.method === "POST") {
            const { prompt_base } = await req.json();
            if (!prompt_base || prompt_base.length < 10) throw new Error("Prompt is too short or missing.");

            // Get latest version
            const { data: latest } = await sbAdmin
                .schema("ap")
                .from("editorial_prompt_versions")
                .select("version_number")
                .eq("cliente_id", clienteId)
                .order("version_number", { ascending: false })
                .limit(1)
                .maybeSingle();

            const nextVersion = (latest?.version_number || 0) + 1;

            // Deactivate existing
            await sbAdmin
                .schema("ap")
                .from("editorial_prompt_versions")
                .update({ is_active: false })
                .eq("cliente_id", clienteId);

            // Insert new
            const { data: newPrompt, error } = await sbAdmin
                .schema("ap")
                .from("editorial_prompt_versions")
                .insert({
                    cliente_id: clienteId,
                    version_number: nextVersion,
                    prompt_base,
                    is_active: true
                })
                .select()
                .single();

            if (error) throw error;

            return new Response(JSON.stringify(newPrompt), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    } catch (err: any) {
        console.error("Prompt Err:", err);
        return new Response(JSON.stringify({ error: err instanceof EditorialAdminAuthorizationError ? "EDITORIAL_ADMIN_REQUIRED" : err.message }), {
            status: err instanceof EditorialAdminAuthorizationError ? err.status : 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
