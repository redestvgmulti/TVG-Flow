export type VisualTitleSnapshot = {
  id: string;
  name: string;
  slug: string;
  bucket: string;
  path: string;
  version: string;
  sha256: string;
  group_id: string | null;
  group_name_at_selection: string | null;
  group_slug_at_selection: string | null;
};

export class VisualTitleResolutionError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.name = "VisualTitleResolutionError";
    this.code = code;
  }
}

const hasText = (value: unknown) =>
  typeof value === "string" && Boolean(value.trim());

export function shouldResolveVisualTitleForCreation(
  existingCandidate: unknown,
) {
  return !existingCandidate;
}

export async function resolveVisualTitleForCreation(
  supabase: any,
  {
    visualTitleId,
    clienteId,
    contentType,
  }: {
    visualTitleId: string | null;
    clienteId: string;
    contentType: string;
  },
): Promise<VisualTitleSnapshot | null> {
  if (!visualTitleId) return null;

  const { data: title, error: titleError } = await supabase
    .schema("ap")
    .from("visual_titles")
    .select(
      "id,cliente_id,group_id,nome,slug,asset_bucket,asset_path,asset_version,sha256,formatos,ativo",
    )
    .eq("id", visualTitleId)
    .eq("cliente_id", clienteId)
    .maybeSingle();

  if (titleError) throw titleError;
  if (!title) throw new VisualTitleResolutionError("VISUAL_TITLE_NOT_FOUND");
  if (!title.ativo) {
    throw new VisualTitleResolutionError("VISUAL_TITLE_INACTIVE");
  }
  if (
    !Array.isArray(title.formatos) ||
    !title.formatos.includes(contentType)
  ) {
    throw new VisualTitleResolutionError("VISUAL_TITLE_FORMAT_INVALID");
  }
  if (
    !hasText(title.asset_bucket) ||
    !hasText(title.asset_path) ||
    !hasText(title.asset_version) ||
    !hasText(title.sha256)
  ) {
    throw new VisualTitleResolutionError("VISUAL_TITLE_ASSET_INVALID");
  }

  let group: { id: string; nome: string; slug: string; ativo: boolean } | null =
    null;
  if (title.group_id) {
    const { data, error } = await supabase
      .schema("ap")
      .from("visual_title_groups")
      .select("id,nome,slug,ativo")
      .eq("id", title.group_id)
      .eq("cliente_id", clienteId)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new VisualTitleResolutionError("VISUAL_TITLE_GROUP_NOT_FOUND");
    }
    if (!data.ativo) {
      throw new VisualTitleResolutionError("VISUAL_TITLE_GROUP_INACTIVE");
    }
    group = data;
  }

  return {
    id: title.id,
    name: title.nome,
    slug: title.slug,
    bucket: title.asset_bucket,
    path: title.asset_path,
    version: title.asset_version,
    sha256: title.sha256,
    group_id: group?.id ?? null,
    group_name_at_selection: group?.nome ?? null,
    group_slug_at_selection: group?.slug ?? null,
  };
}
