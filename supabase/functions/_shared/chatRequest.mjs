import { UUID_PATTERN } from "./chatAuth.mjs";

export class ChatPayloadError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "ChatPayloadError";
    this.code = code;
    this.status = status;
  }
}

export const EDITORIAL_CHAT_OPERATIONS = new Set([
  "chat",
  "generate_from_link",
  "rewrite",
  "improve_title",
  "correct",
  "summarize",
  "variations",
]);

const CHAT_OPERATIONS = new Set([
  ...EDITORIAL_CHAT_OPERATIONS,
  "list_conversations",
  "get_conversation",
  "create_conversation",
  "archive_conversation",
]);

export function parseChatOperation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ChatPayloadError("CHAT_REQUEST_INVALID");
  }
  if (!CHAT_OPERATIONS.has(value.operation)) {
    throw new ChatPayloadError("CHAT_OPERATION_UNSUPPORTED");
  }
  if (
    (value.operation === "get_conversation" || value.operation === "archive_conversation") &&
    (typeof value.conversation_id !== "string" || !UUID_PATTERN.test(value.conversation_id))
  ) {
    throw new ChatPayloadError("CHAT_CONVERSATION_ID_INVALID");
  }
  return value.operation;
}

export function parseChatBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ChatPayloadError("CHAT_REQUEST_INVALID");
  }
  const operation = parseChatOperation(value);
  if (!EDITORIAL_CHAT_OPERATIONS.has(operation)) throw new ChatPayloadError("CHAT_OPERATION_UNSUPPORTED");
  if (typeof value.request_id !== "string" || !UUID_PATTERN.test(value.request_id)) {
    throw new ChatPayloadError("CHAT_REQUEST_ID_INVALID");
  }
  if (
    value.conversation_id !== undefined && value.conversation_id !== null &&
    (typeof value.conversation_id !== "string" || !UUID_PATTERN.test(value.conversation_id))
  ) {
    throw new ChatPayloadError("CHAT_CONVERSATION_ID_INVALID");
  }
  const maximumMessageLength = operation === "generate_from_link" ? 2048 : 50000;
  if (typeof value.message !== "string" || value.message.trim().length < 1 || value.message.trim().length > maximumMessageLength) {
    throw new ChatPayloadError("CHAT_MESSAGE_INVALID");
  }
  if (value.title !== undefined && (typeof value.title !== "string" || value.title.trim().length > 160)) {
    throw new ChatPayloadError("CHAT_TITLE_INVALID");
  }

  // Deliberately do not copy arbitrary fields such as user_id or cliente_id.
  return {
    operation,
    requestId: value.request_id,
    conversationId: typeof value.conversation_id === "string" ? value.conversation_id : null,
    message: value.message.trim(),
    title: typeof value.title === "string" ? value.title.trim() : null,
  };
}

export function boundedChatHistory(rows, maximumCharacters = 160000) {
  const selected = [];
  let characters = 0;
  // The repository returns newest first. Keep the newest bounded suffix, then
  // reverse it before sending chronological history to the provider.
  for (const row of rows) {
    if (row.role !== "user" && row.role !== "assistant") continue;
    if (characters + row.content.length > maximumCharacters && selected.length > 0) break;
    selected.push({ role: row.role, content: row.content });
    characters += row.content.length;
  }
  return selected.reverse();
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
