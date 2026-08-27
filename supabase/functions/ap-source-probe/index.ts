import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { EditorialAdminAuthorizationError, requireEditorialAdmin } from "../_shared/editorialAdminAuth.ts";
import { collectSource, SourceCollectionError } from "../_shared/sourceCollector.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const body = await req.json();
    const clienteId = typeof body?.cliente_id === "string" ? body.cliente_id : "";
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (!clienteId || !url) return json({ error: "SOURCE_URL_REQUIRED" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "SERVER_CONFIGURATION_ERROR" }, 500);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await requireEditorialAdmin(req, admin, clienteId);

    const result = await collectSource({
      url,
      nome: typeof body?.nome === "string" ? body.nome.trim() : "",
      tipo: typeof body?.tipo === "string" ? body.tipo : "auto",
    }, { maxItems: 3 });

    return json({
      ok: true,
      detected_type: result.detectedType,
      discovery_url: result.discoveryUrl,
      discovered_count: result.items.length,
      previews: result.items.map((item) => ({
        title: item.title,
        url: item.canonicalUrl || item.url,
        published_at: item.publishedAt,
        image_url: item.imageUrl,
      })),
    });
  } catch (error) {
    if (error instanceof EditorialAdminAuthorizationError) {
      return json({ error: "EDITORIAL_ADMIN_REQUIRED" }, error.status);
    }
    if (error instanceof SourceCollectionError) {
      return json({ error: error.code }, 422);
    }
    return json({ error: "SOURCE_PROBE_FAILED" }, 422);
  }
});
