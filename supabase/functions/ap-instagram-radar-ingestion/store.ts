export type RadarSource = {
  id: string;
  cliente_id: string;
  nome: string | null;
  url: string;
  tipo: "instagram";
  consecutive_failures: number | null;
};

export type RadarConnection = {
  instagram_user_id: string | null;
  graph_api_version: string | null;
  token_secret_ref: string | null;
  granted_scopes: string[] | null;
  capabilities: { radar_read?: boolean; [key: string]: unknown } | null;
  expires_at: string | null;
};

export type RadarSourceStateUpdate = {
  detected_type?: "instagram";
  last_checked_at: string;
  last_success_at?: string;
  last_error_code: string | null;
  consecutive_failures: number;
  last_discovered_count: number;
  last_collected_count: number;
};

export type RadarIngestionRunMetadata = {
  correlation_id: string;
  provider: "meta_business_discovery";
  mode: "instagram_radar";
  complete: boolean;
  calls: number;
  duplicate_count?: number;
  valid_count?: number;
  duration_ms?: number;
};

export type RadarIngestionRunInput = {
  source_id: string;
  cliente_id: string;
  worker_id: string;
  detected_type: "instagram";
  status: "success" | "completed_with_errors" | "error";
  discovered_count: number;
  collected_count: number;
  skipped_old_count: number;
  error_count: number;
  error_code: string | null;
  started_at: string;
  finished_at: string;
  metadata: RadarIngestionRunMetadata;
};

export type RadarCollectedNewsMetadata = {
  platform: "instagram";
  provider: "meta_business_discovery";
  external_id: string;
  media_type: string;
  source_username: string;
  source_name: string | null;
  discovery_complete: boolean;
  parser_version: string;
};

export type RadarCollectedNewsInput = {
  p_cliente_id: string;
  p_source_id: string;
  p_url_original: string;
  p_canonical_url: string;
  p_title: string;
  p_excerpt: string | null;
  p_content: string | null;
  p_image_url: string | null;
  p_published_at: string;
  p_content_hash: string;
  p_parser_version: string;
  p_metadata: RadarCollectedNewsMetadata;
};

export type RadarCollectedNewsResult = { created: boolean };

export type RadarIngestionStoreErrorCode =
  | "RADAR_CONFIG_READ_FAILED"
  | "RADAR_SOURCES_READ_FAILED"
  | "RADAR_CONNECTION_READ_FAILED"
  | "RADAR_SECRET_READ_FAILED"
  | "RADAR_COLLECTED_NEWS_INGEST_FAILED"
  | "RADAR_SOURCE_STATE_WRITE_FAILED"
  | "RADAR_INGESTION_RUN_WRITE_FAILED";

export class RadarIngestionStoreError extends Error {
  constructor(readonly code: RadarIngestionStoreErrorCode) {
    super(code);
    this.name = "RadarIngestionStoreError";
  }
}

export interface RadarIngestionStore {
  loadDisabledTenantIds(): Promise<string[]>;
  loadInstagramSources(
    disabledTenantIds: string[],
    limit: number,
  ): Promise<RadarSource[]>;
  loadPrimaryMetaConnection(clienteId: string): Promise<RadarConnection | null>;
  readMetaSecret(secretRef: string): Promise<string | null>;
  ingestCollectedNews(
    input: RadarCollectedNewsInput,
  ): Promise<RadarCollectedNewsResult>;
  updateSourceState(
    sourceId: string,
    clienteId: string,
    update: RadarSourceStateUpdate,
  ): Promise<void>;
  insertIngestionRun(run: RadarIngestionRunInput): Promise<void>;
}

/** Supabase-only I/O adapter; business decisions remain in worker.ts. */
export class SupabaseRadarIngestionStore implements RadarIngestionStore {
  constructor(private readonly admin: any) {}

  async loadDisabledTenantIds(): Promise<string[]> {
    const { data, error } = await this.admin.schema("ap").from(
      "system_config",
    ).select("cliente_id").eq("ingestion_enabled", false);
    if (error) throw new RadarIngestionStoreError("RADAR_CONFIG_READ_FAILED");
    return (data ?? []).map((row: { cliente_id: string }) => row.cliente_id);
  }

  async loadInstagramSources(
    disabledTenantIds: string[],
    limit: number,
  ): Promise<RadarSource[]> {
    let query: any = this.admin.schema("ap").from("sources").select(
      "id,cliente_id,nome,url,tipo,consecutive_failures,last_checked_at,created_at",
    ).eq("tipo", "instagram").eq("ativo", true).order("last_checked_at", {
      ascending: true,
      nullsFirst: true,
    }).order("created_at", { ascending: true });
    if (disabledTenantIds.length) {
      query = query.not(
        "cliente_id",
        "in",
        `(${disabledTenantIds.join(",")})`,
      );
    }
    const { data, error } = await query.limit(limit);
    if (error) throw new RadarIngestionStoreError("RADAR_SOURCES_READ_FAILED");
    return (data ?? []) as RadarSource[];
  }

  async loadPrimaryMetaConnection(
    clienteId: string,
  ): Promise<RadarConnection | null> {
    const { data, error } = await this.admin.schema("ap").from(
      "instagram_connections",
    ).select(
      "instagram_user_id,graph_api_version,token_secret_ref,granted_scopes,capabilities,expires_at",
    ).eq("cliente_id", clienteId).eq("provider", "meta").eq(
      "status",
      "connected",
    ).eq("is_primary", true).order("updated_at", { ascending: false })
      .maybeSingle();
    if (error) {
      throw new RadarIngestionStoreError("RADAR_CONNECTION_READ_FAILED");
    }
    return data as RadarConnection | null;
  }

  async readMetaSecret(secretRef: string): Promise<string | null> {
    const { data, error } = await this.admin.schema("ap").rpc(
      "meta_read_secret",
      { p_secret_id: secretRef },
    );
    if (error) throw new RadarIngestionStoreError("RADAR_SECRET_READ_FAILED");
    return typeof data === "string" && data ? data : null;
  }

  async ingestCollectedNews(
    input: RadarCollectedNewsInput,
  ): Promise<RadarCollectedNewsResult> {
    const { data, error } = await this.admin.schema("ap").rpc(
      "ingest_collected_news",
      input,
    );
    if (error) {
      throw new RadarIngestionStoreError(
        "RADAR_COLLECTED_NEWS_INGEST_FAILED",
      );
    }
    return { created: data?.created === true };
  }

  async updateSourceState(
    sourceId: string,
    clienteId: string,
    update: RadarSourceStateUpdate,
  ): Promise<void> {
    const { error } = await this.admin.schema("ap").from("sources").update(
      update,
    ).eq("id", sourceId).eq("cliente_id", clienteId);
    if (error) {
      throw new RadarIngestionStoreError(
        "RADAR_SOURCE_STATE_WRITE_FAILED",
      );
    }
  }

  async insertIngestionRun(run: RadarIngestionRunInput): Promise<void> {
    const { error } = await this.admin.schema("ap").from(
      "source_ingestion_runs",
    ).insert(run);
    if (error) {
      throw new RadarIngestionStoreError(
        "RADAR_INGESTION_RUN_WRITE_FAILED",
      );
    }
  }
}
