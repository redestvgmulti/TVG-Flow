// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Config Manager: Sources & Sponsors
// MODE: SINGLE-TENANT (TVG only)
// Usa fetch direto ao PostgREST com Accept-Profile: ap (bypassa SDK + RLS)
// verify_jwt: false
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const FIXED_CLIENT_ID = "cd287e6e-f273-4d0f-a72d-2a8c391e40e9";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Headers para PostgREST com schema ap + service role (bypassa RLS)
    const pgHeaders = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_ROLE}`,
        "apikey": SERVICE_ROLE,
        "Accept-Profile": "ap",
        "Content-Profile": "ap",
    };

    try {
        const body = await req.json();
        const { resource, action, payload } = body;

        console.log("[ap-config] resource:", resource, "action:", action);

        if (!resource || !["sources", "patrocinadores", "templates", "template_sets"].includes(resource)) {
            throw new Error(`resource inválido: '${resource}'. Use 'sources', 'patrocinadores', 'templates' ou 'template_sets'`);
        }

        const base = `${SUPABASE_URL}/rest/v1/${resource}`;

        // Handle tenant column name differences
        const tenantCol = ['templates', 'template_sets'].includes(resource) ? 'empresa_id' : 'cliente_id';

        if (action === "list") {
            const orderCol = resource === 'templates' ? 'ordem.asc,criado_em.asc' : 'created_at.asc';
            const res = await fetch(
                `${base}?${tenantCol}=eq.${FIXED_CLIENT_ID}&order=${orderCol}`,
                { method: "GET", headers: pgHeaders }
            );
            if (!res.ok) throw new Error(`PostgREST list error: ${await res.text()}`);
            const data = await res.json();
            return new Response(JSON.stringify(data), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        // ── INSERT ─────────────────────────────────────────────────
        if (action === "insert") {
            if (!payload) throw new Error("payload required for insert");
            const row = { ...payload, [tenantCol]: FIXED_CLIENT_ID };

            const res = await fetch(base, {
                method: "POST",
                headers: { ...pgHeaders, "Prefer": "return=representation" },
                body: JSON.stringify(row)
            });
            if (!res.ok) throw new Error(`PostgREST insert error: ${await res.text()}`);
            const data = await res.json();
            return new Response(JSON.stringify(Array.isArray(data) ? data[0] : data), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        // ── UPDATE ─────────────────────────────────────────────────
        if (action === "update") {
            if (!payload?.id) throw new Error("payload.id required for update");
            const { id, ...fields } = payload;

            const res = await fetch(
                `${base}?id=eq.${id}&${tenantCol}=eq.${FIXED_CLIENT_ID}`,
                {
                    method: "PATCH",
                    headers: { ...pgHeaders, "Prefer": "return=representation" },
                    body: JSON.stringify(fields)
                }
            );
            if (!res.ok) throw new Error(`PostgREST update error: ${await res.text()}`);
            const data = await res.json();
            return new Response(JSON.stringify(Array.isArray(data) ? data[0] : data), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        // ── DELETE ─────────────────────────────────────────────────
        if (action === "delete") {
            if (!payload?.id) throw new Error("payload.id required for delete");

            const res = await fetch(
                `${base}?id=eq.${payload.id}&${tenantCol}=eq.${FIXED_CLIENT_ID}`,
                { method: "DELETE", headers: pgHeaders }
            );
            if (!res.ok) throw new Error(`PostgREST delete error: ${await res.text()}`);
            return new Response(JSON.stringify({ success: true }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        throw new Error(`action inválida: '${action}'. Use: list, insert, update, delete`);

    } catch (err: any) {
        console.error("[ap-config] ERROR:", err);
        return new Response(JSON.stringify({
            has_error: true,
            error: err.message,
            stack: err.stack,
            type: err.name
        }), {
            status: 200, // Retornando 200 para forçar o SDK a expor o BODY JSON no `data`
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }
});
