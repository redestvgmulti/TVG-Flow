// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Motor Editorial: Prompt Versioning API
// POST: create new version and deactivate old
// GET: list history
// verify_jwt: true
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

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
        const { data: profData } = await supabase
            .from("cliente_profissionais")
            .select("cliente_id")
            .eq("profissional_id", user.id)
            .eq("ativo", true)
            .limit(1)
            .maybeSingle();

        if (!profData) throw new Error("User has no active tenant");
        clienteId = profData.cliente_id;

        const sbAdmin = createClient(supabaseUrl, supabaseServiceRole);

        if (req.method === "GET") {
            const { data: history } = await sbAdmin
                .from("ap.editorial_prompt_versions")
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
                .from("ap.editorial_prompt_versions")
                .select("version_number")
                .eq("cliente_id", clienteId)
                .order("version_number", { ascending: false })
                .limit(1)
                .maybeSingle();

            const nextVersion = (latest?.version_number || 0) + 1;

            // Deactivate existing
            await sbAdmin
                .from("ap.editorial_prompt_versions")
                .update({ is_active: false })
                .eq("cliente_id", clienteId);

            // Insert new
            const { data: newPrompt, error } = await sbAdmin
                .from("ap.editorial_prompt_versions")
                .insert({
                    cliente_id: clienteId,
                    version_number: nextVersion,
                    prompt_base,
                    created_by: user.id,
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
        return new Response(JSON.stringify({ error: err.message }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
