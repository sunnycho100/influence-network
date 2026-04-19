import type { GraphSnapshot, Profile } from './models.js';

export type PingMessage = {
  type: "PING";
};

export type GetGraphMessage = {
  type: "GET_GRAPH";
};

export type GetProfileMessage = {
  type: "GET_PROFILE";
  profileId: string;
};

export type GenerateMessageRequest = {
  type: "GENERATE_MESSAGE";
  profileId: string;
};

export type MarkSentMessage = {
  type: "MARK_SENT";
  messageId: string;
};

export type ExportDataMessage = {
  type: "EXPORT_DATA";
};

export type ImportDataMessage = {
  type: "IMPORT_DATA";
  profiles: Profile[];
};

export type ExtensionMessage =
  | PingMessage
  | GetGraphMessage
  | GetProfileMessage
  | GenerateMessageRequest
  | MarkSentMessage
  | ExportDataMessage
  | ImportDataMessage;

export type OkResponse<T> = {
  ok: true;
  data: T;
};

export type ErrorResponse = {
  ok: false;
  error: string;
};

export type ExtensionResponse<T = unknown> = OkResponse<T> | ErrorResponse;

export type PingResponse = ExtensionResponse<{ version: string }>;
export type GraphResponse = ExtensionResponse<GraphSnapshot>;
export type ProfileResponse = ExtensionResponse<Profile | undefined>;
export type GenerateMessageResponse = ExtensionResponse<{ draft: string }>;
export type MarkSentResponse = ExtensionResponse<null>;
export type ExportDataResponse = ExtensionResponse<{ profiles: Profile[] }>;
export type ImportDataResponse = ExtensionResponse<{ imported: number }>;

export type AllowedOrigin =
  | 'http://localhost:5173'
  | 'http://127.0.0.1:5173'
  | 'https://alumni-graph.vercel.app';

export function isExtensionMessage(message: unknown): message is ExtensionMessage {
  if (!message || typeof message !== "object") {
    return false;
  }

  const type = (message as { type?: unknown }).type;
  return (
    type === "PING" ||
    type === "GET_GRAPH" ||
    type === "GET_PROFILE" ||
    type === "GENERATE_MESSAGE" ||
    type === "MARK_SENT" ||
    type === "EXPORT_DATA" ||
    type === "IMPORT_DATA"
  );
}

export function isAllowedOrigin(url?: string): boolean {
  if (typeof url !== 'string' || url.length === 0) {
    return false;
  }

  try {
    const origin = new URL(url).origin as AllowedOrigin;
    return (
      origin === 'http://localhost:5173' ||
      origin === 'http://127.0.0.1:5173' ||
      origin === 'https://alumni-graph.vercel.app'
    );
  } catch {
    return false;
  }
}
