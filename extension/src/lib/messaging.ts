import {
  isAllowedOrigin,
  isExtensionMessage,
  type GraphResponse,
  type ProfileResponse,
  type ExtensionResponse,
  type PingResponse,
} from '@alumni-graph/shared';

import { getGraphSnapshot, getProfileById } from './db';

const APP_VERSION = '0.1.0';

export function handleExternalMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<PingResponse | GraphResponse | ProfileResponse | ExtensionResponse<never>> {
  return respondToExternalMessage(message, sender);
}

async function respondToExternalMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<PingResponse | GraphResponse | ProfileResponse | ExtensionResponse<never>> {
  if (!isExtensionMessage(message)) {
    return { ok: false, error: 'invalid_message' };
  }

  if (!isAllowedOrigin(sender.url)) {
    return { ok: false, error: 'unauthorized_origin' };
  }

  switch (message.type) {
    case 'PING':
      return {
        ok: true,
        data: {
          version: APP_VERSION,
        },
      };
    case 'GET_GRAPH':
      return {
        ok: true,
        data: await getGraphSnapshot(),
      };
    case 'GET_PROFILE':
      return {
        ok: true,
        data: await getProfileById(message.profileId),
      };
    default:
      return { ok: false, error: 'unsupported_message_type' };
  }
}
