import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  authorizeConfigRequest,
  ConfigAuthorizationError,
} from "./authorization.ts";
import { normalizeInstagramProfile } from "../_shared/social/instagramProfile.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESOURCES = {
  sources: { table: "sources", ownerColumn: "cliente_id", order: "created_at.asc" },
  instagram_sources: { table: "sources", ownerColumn: "cliente_id", order: "created_at.asc" },
  patrocinadores: { table: "patrocinadores", ownerColumn: "cliente_id", order: "created_at.asc" },
  templates: { table: "templates", ownerColumn: "empresa_id", order: "ordem.asc,criado_em.asc" },
  // Legacy debt: this column contains cliente_id values in existing rows.
  template_sets: { table: "template_sets", ownerColumn: "empresa_id", order: "created_at.asc" },
} as const;

type Resource = keyof typeof RESOURCES;
type Action = "list" | "insert" | "update" | "delete";

class ConfigRequestError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ConfigRequestError";
    this.status = status;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function configError(error: unknown) {
  if (error instanceof ConfigAuthorizationError) return json({ error: error.code }, error.status);
  if (error instanceof ConfigRequestError) return json({ error: error.message }, error.status);
  console.error("[ap-config] request failed", {
    name: error instanceof Error ? error.name : "UnknownError",
  });
  return json({ error: "CONFIG_OPERATION_FAILED" }, 500);
}

function isResource(value: unknown): value is Resource {
  return typeof value === "string" && value in RESOURCES;
}

function isAction(value: unknown): value is Action {
  return value === "list" || value === "insert" || value === "update" || value === "delete";
}

function payloadObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigRequestError("PAYLOAD_REQUIRED");
  }
  return { ...(value as Record<string, unknown>) };
}

function sanitizedFields(payload: Record<string, unknown>, ownerColumn: string) {
  const fields = { ...payload };
  delete fields.id;
  if (ownerColumn in fields || "cliente_id" in fields || "empresa_id" in fields) {
    throw new ConfigRequestError("OWNER_SCOPE_MANAGED_BY_SERVER", 403);
  }
  return fields;
}

function instagramSourceId(payload: Record<string, unknown>) {
  const id = typeof payload.id === "string" ? payload.id : null;
  if (!id) throw new ConfigRequestError("CONFIG_RECORD_ID_REQUIRED");
  return id;
}

function sourcePayload(payload: unknown) {
  const fields = payloadObject(payload);
  if ("cliente_id" in fields || "empresa_id" in fields) {
    throw new ConfigRequestError("OWNER_SCOPE_MANAGED_BY_SERVER", 403);
  }
  return fields;
}

async function instagramSourceHistoryExists(supabase: any, clienteId: string, sourceId: string) {
  const [collected, runs] = await Promise.all([
    supabase.from("collected_news").select("id", { count: "exact", head: true })
      .eq("cliente_id", clienteId).eq("source_id", sourceId),
    supabase.from("source_ingestion_runs").select("id", { count: "exact", head: true })
      .eq("cliente_id", clienteId).eq("source_id", sourceId),
  ]);
  if (collected.error) throw collected.error;
  if (runs.error) throw runs.error;
  return (collected.count ?? 0) > 0 || (runs.count ?? 0) > 0;
}

async function handleInstagramSources({ supabase, clienteId, action, payload }: {
  supabase: any;
  clienteId: string;
  action: Action;
  payload: unknown;
}) {
  const sources = supabase.from("sources");
  const fields = action === "list" ? null : sourcePayload(payload);

  if (action === "list") {
    const { data, error } = await sources
      .select("id,nome,url,ativo,last_checked_at,last_success_at,last_error_code,consecutive_failures,last_discovered_count,last_collected_count,created_at")
      .eq("cliente_id", clienteId)
      .eq("tipo", "instagram")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  if (action === "insert") {
    if (Object.keys(fields!).some((key) => key !== "input")) {
      throw new ConfigRequestError("INSTAGRAM_SOURCE_PAYLOAD_INVALID");
    }
    let profile;
    try {
      profile = normalizeInstagramProfile(fields!.input);
    } catch {
      throw new ConfigRequestError("INSTAGRAM_SOURCE_INVALID");
    }

    const { data: existing, error: existingError } = await sources
      .select("id")
      .eq("cliente_id", clienteId)
      .eq("tipo", "instagram")
      .eq("url", profile.url)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) throw new ConfigRequestError("INSTAGRAM_SOURCE_ALREADY_EXISTS", 409);

    const { data, error } = await sources
      .insert({
        cliente_id: clienteId,
        nome: `@${profile.username}`,
        url: profile.url,
        tipo: "instagram",
        detected_type: "instagram",
        ativo: true,
      })
      .select("id,nome,url,ativo,last_checked_at,last_success_at,last_error_code,consecutive_failures,last_discovered_count,last_collected_count,created_at")
      .single();
    if (error) throw error;
    return data;
  }

  const id = instagramSourceId(fields!);
  if (action === "update") {
    if (Object.keys(fields!).some((key) => key !== "id" && key !== "ativo") || typeof fields!.ativo !== "boolean") {
      throw new ConfigRequestError("INSTAGRAM_SOURCE_PAYLOAD_INVALID");
    }
    const { data, error } = await sources
      .update({ ativo: fields!.ativo })
      .eq("id", id)
      .eq("cliente_id", clienteId)
      .eq("tipo", "instagram")
      .select("id,nome,url,ativo,last_checked_at,last_success_at,last_error_code,consecutive_failures,last_discovered_count,last_collected_count,created_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ConfigRequestError("CONFIG_RECORD_NOT_FOUND", 404);
    return data;
  }

  if (Object.keys(fields!).some((key) => key !== "id")) {
    throw new ConfigRequestError("INSTAGRAM_SOURCE_PAYLOAD_INVALID");
  }
  const hasHistory = await instagramSourceHistoryExists(supabase, clienteId, id);
  if (hasHistory) {
    const { data, error } = await sources
      .update({ ativo: false })
      .eq("id", id)
      .eq("cliente_id", clienteId)
      .eq("tipo", "instagram")
      .select("id,nome,url,ativo,last_checked_at,last_success_at,last_error_code,consecutive_failures,last_discovered_count,last_collected_count,created_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ConfigRequestError("CONFIG_RECORD_NOT_FOUND", 404);
    return { success: true, deactivated: true, source: data };
  }

  const { data, error } = await sources
    .delete()
    .eq("id", id)
    .eq("cliente_id", clienteId)
    .eq("tipo", "instagram")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ConfigRequestError("CONFIG_RECORD_NOT_FOUND", 404);
  return { success: true, deactivated: false };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const body = await req.json();
    const { resource, action, payload, cliente_id: requestedClienteId } = body ?? {};
    if (!isResource(resource)) throw new ConfigRequestError("RESOURCE_INVALID");
    if (!isAction(action)) throw new ConfigRequestError("ACTION_INVALID");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) throw new ConfigRequestError("SERVER_CONFIGURATION_ERROR", 500);

    // No service-role client exists until this JWT, profile, role and client scope pass.
    const authorization = await authorizeConfigRequest({
      authorization: req.headers.get("Authorization"),
      requestedClienteId,
      createUserClient: (token) => createClient(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      }),
    });

    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRole) throw new ConfigRequestError("SERVER_CONFIGURATION_ERROR", 500);
    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: { autoRefreshToken: false, persistSession: false },
    }).schema("ap");

    if (resource === "instagram_sources") {
      return json(await handleInstagramSources({
        supabase,
        clienteId: authorization.clienteId,
        action,
        payload,
      }));
    }

    const { table, ownerColumn, order } = RESOURCES[resource];
    const base = supabase.from(table);

    if (action === "list") {
      let query = base
        .select("*")
        .eq(ownerColumn, authorization.clienteId);
      for (const orderColumn of order.split(",")) {
        const [column, direction] = orderColumn.split(".");
        query = query.order(column, { ascending: direction !== "desc" });
      }
      const { data, error } = await query;
      if (error) throw error;
      return json(data ?? []);
    }

    const rawPayload = payloadObject(payload);

    if (action === "insert") {
      const fields = sanitizedFields(rawPayload, ownerColumn);
      const { data, error } = await base
        .insert({ ...fields, [ownerColumn]: authorization.clienteId })
        .select()
        .single();
      if (error) throw error;
      return json(data);
    }

    const id = typeof rawPayload.id === "string" ? rawPayload.id : null;
    if (!id) throw new ConfigRequestError("CONFIG_RECORD_ID_REQUIRED");
    const fields = sanitizedFields(rawPayload, ownerColumn);

    if (action === "update") {
      const { data, error } = await base
        .update(fields)
        .eq("id", id)
        .eq(ownerColumn, authorization.clienteId)
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new ConfigRequestError("CONFIG_RECORD_NOT_FOUND", 404);
      return json(data);
    }

    const { data, error } = await base
      .delete()
      .eq("id", id)
      .eq(ownerColumn, authorization.clienteId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ConfigRequestError("CONFIG_RECORD_NOT_FOUND", 404);
    return json({ success: true });
  } catch (error) {
    return configError(error);
  }
});
