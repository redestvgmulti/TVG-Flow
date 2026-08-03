const MAX_PLACID_ERROR_BODY_LENGTH = 6000;

const SENSITIVE_JSON_FIELD =
  /"(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|headers?)"\s*:\s*"(?:\\.|[^"\\])*"/gi;

export type PlacidErrorTelemetryInput = {
  status: number;
  responseBody: string;
  templateUuid: string;
  layerNames: string[];
  correlationId: string;
  candidateId: string;
};

export function sanitizePlacidErrorBody(rawBody: string) {
  const sanitized = String(rawBody || "")
    .replace(
      SENSITIVE_JSON_FIELD,
      (field) => `${field.slice(0, field.indexOf(":"))}:"[REDACTED]"`,
    )
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[JWT_REDACTED]",
    )
    .replace(
      /([?&](?:token|key|signature|sig|expires|x-amz-[^=]+)=)[^&#\s"']+/gi,
      "$1[REDACTED]",
    );
  return {
    body: sanitized.slice(0, MAX_PLACID_ERROR_BODY_LENGTH),
    truncated: sanitized.length > MAX_PLACID_ERROR_BODY_LENGTH,
  };
}

export function buildPlacidErrorTelemetry(
  input: PlacidErrorTelemetryInput,
) {
  const response = sanitizePlacidErrorBody(input.responseBody);
  return {
    event: "PLACID_REQUEST_FAILED",
    status: input.status,
    response_body: response.body,
    response_body_truncated: response.truncated,
    template_uuid: input.templateUuid,
    layer_names: [...input.layerNames],
    correlation_id: input.correlationId,
    candidate_id: input.candidateId,
  };
}
