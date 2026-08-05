import { runEditorialWorkflow } from "../_shared/editorialWorkflow.ts";

export class TerritorialCandidateRpcError extends Error {
  raw: unknown;

  constructor(raw: unknown) {
    super("TERRITORIAL_CANDIDATE_RPC_FAILED");
    this.name = "TerritorialCandidateRpcError";
    this.raw = raw;
  }
}

async function claimEditorialProcessing(supabase: any, newsId: string) {
  const { data, error } = await supabase
    .schema("ap")
    .from("candidate_news")
    .update({ processing_started_at: new Date().toISOString() })
    .eq("id", newsId)
    .eq("status", "processing")
    .is("processing_started_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error("EDITORIAL_CLAIM_FAILED");
  return Boolean(data?.id);
}

async function releaseReservation(
  supabase: any,
  candidateId: string,
  reason: string,
) {
  const { error } = await supabase
    .schema("ap")
    .rpc("release_territorial_composer_candidate", {
      p_candidate_id: candidateId,
      p_reason: reason,
    });
  if (error) {
    throw new Error("TERRITORIAL_RESERVATION_RELEASE_FAILED");
  }
}

export type TerritorialWorkflowResult = {
  news: Record<string, any>;
  reused: boolean;
  claimed: boolean;
};

export async function createAndProcessTerritorialCandidate(input: {
  serviceSupabase: any;
  userSupabase: any;
  clienteId: string;
  idempotencyKey: string;
  contentType: string;
  composerMode: string;
  requestedHeadline: string;
  requestedText: string;
  userHeadline: string | null;
  userText: string | null;
  userTag: string | null;
  urlOriginal: string | null;
  imageUrl: string | null;
  regionId: string | null;
  cityId: string | null;
  visualTitleId: string | null;
  manualSlots: unknown[];
}): Promise<TerritorialWorkflowResult> {
  const { data: rpcResult, error: rpcError } = await input.userSupabase
    .schema("ap")
    .rpc("create_territorial_composer_candidate", {
      p_cliente_id: input.clienteId,
      p_idempotency_key: input.idempotencyKey,
      p_content_type: input.contentType,
      p_composer_mode: input.composerMode,
      p_titulo: input.userHeadline || input.requestedHeadline,
      p_conteudo: input.userText || input.requestedText,
      p_url_original: input.urlOriginal || null,
      p_imagem_url: input.imageUrl,
      p_context_tag: input.userTag || "DESTAQUE",
      p_region_id: input.regionId,
      p_city_id: input.cityId,
      p_visual_title_id: input.visualTitleId,
      p_manual_slots: input.manualSlots,
    });

  if (rpcError) throw new TerritorialCandidateRpcError(rpcError);

  const news = rpcResult?.candidate_news;
  if (!news?.id) {
    throw new Error("TERRITORIAL_CANDIDATE_INVALID_RESPONSE");
  }
  const reused = Boolean(rpcResult.reused);

  if (
    reused &&
    ["pending_render", "pending_review", "approved"].includes(news.status)
  ) {
    return { news, reused, claimed: true };
  }

  if (!await claimEditorialProcessing(input.serviceSupabase, news.id)) {
    return { news, reused: true, claimed: false };
  }

  try {
    const result = await runEditorialWorkflow(input.serviceSupabase, {
      newsId: news.id,
      clienteId: input.clienteId,
      userHeadline: input.userHeadline,
      userTag: input.userTag,
      userText: input.userText,
      contentType: input.contentType as any,
    });
    const { data: finalizeResult, error: finalizeError } = await input
      .serviceSupabase
      .schema("ap")
      .rpc("finalize_territorial_composer_candidate", {
        p_candidate_id: news.id,
        p_headline: result.headline,
        p_caption: result.caption,
        p_context_tag: result.context_tag,
        p_roteiro_json: result.roteiro_json,
      });
    if (finalizeError) {
      throw new TerritorialCandidateRpcError(finalizeError);
    }
    const finalizedNews = finalizeResult?.candidate_news;
    if (!finalizedNews?.id) {
      throw new Error("TERRITORIAL_CANDIDATE_FINALIZE_INVALID_RESPONSE");
    }

    return {
      news: finalizedNews,
      reused,
      claimed: true,
    };
  } catch (error) {
    await releaseReservation(
      input.serviceSupabase,
      news.id,
      error instanceof Error ? error.message : "generation_failed",
    );
    await input.serviceSupabase
      .schema("ap")
      .from("candidate_news")
      .update({ processing_started_at: null })
      .eq("id", news.id)
      .eq("status", "processing");
    throw error;
  }
}
