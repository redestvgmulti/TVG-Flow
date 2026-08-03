import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildPlacidErrorTelemetry,
  sanitizePlacidErrorBody,
} from "../../supabase/functions/ap-render-engine/placidErrorTelemetry.ts";

test("preserves a safe detailed 422 body", () => {
  const body = JSON.stringify({
    message: "Validation failed",
    errors: [{ layer: "news-image", message: "Image URL is not reachable" }],
  });
  assert.deepEqual(sanitizePlacidErrorBody(body), {
    body,
    truncated: false,
  });
});

test("redacts credentials and signed query values without hiding diagnostics", () => {
  const raw = JSON.stringify({
    message: "invalid image",
    authorization: "Bearer placid-secret",
    token: "private-token",
    image: "https://assets.test/file.png?token=private&expires=123",
  });
  const result = sanitizePlacidErrorBody(raw);
  assert.match(result.body, /invalid image/);
  assert.doesNotMatch(result.body, /placid-secret|private-token|expires=123/);
  assert.match(result.body, /\[REDACTED\]/);
});

test("telemetry contains only required metadata and sanitized body", () => {
  const telemetry = buildPlacidErrorTelemetry({
    status: 422,
    responseBody: '{"error":"invalid layer"}',
    templateUuid: "4e7pghwb4beji",
    layerNames: [
      "titulo-materia",
      "news-image",
      "titulo-png",
      "patrocinador-2",
    ],
    correlationId: "11111111-1111-4111-8111-111111111111",
    candidateId: "22222222-2222-4222-8222-222222222222",
  });
  assert.deepEqual(Object.keys(telemetry), [
    "event",
    "status",
    "response_body",
    "response_body_truncated",
    "template_uuid",
    "layer_names",
    "correlation_id",
    "candidate_id",
  ]);
  assert.equal(telemetry.status, 422);
  assert.equal(telemetry.response_body, '{"error":"invalid layer"}');
  assert.equal(telemetry.response_body_truncated, false);
  assert.equal(telemetry.template_uuid, "4e7pghwb4beji");
  assert.equal(telemetry.layer_names.length, 4);
  assert.equal("headers" in telemetry, false);
  assert.equal("payload" in telemetry, false);
});

test("renderer preserves public error and does not log full request payload", async () => {
  const source = await readFile(
    new URL(
      "../../supabase/functions/ap-render-engine/index.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /await response\.text\(\)\.catch/);
  assert.match(source, /buildPlacidErrorTelemetry/);
  assert.match(source, /"PLACID_REQUEST_FAILED",\s*`status=\$\{response\.status\}`/);
  assert.doesNotMatch(source, /console\.(?:error|warn|log)\([^\n]*JSON\.stringify\(\{ template_uuid/);
});
