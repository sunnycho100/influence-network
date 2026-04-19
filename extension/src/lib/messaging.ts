import {
  isAllowedOrigin,
  isExtensionMessage,
  type ChatQueryResponse,
  type GraphResponse,
  type ProfileResponse,
  type ExtensionResponse,
  type GenerateMessageResponse,
  type MarkSentResponse,
  type ExportDataResponse,
  type ImportDataResponse,
  type PingResponse,
} from '@alumni-graph/shared';

import { db, getGraphSnapshot, getProfileById, applyWarmness } from './db';
import { generateMessage } from './llm';
import { chatQuery } from './chat';

const APP_VERSION = '0.1.0';

type AnyResponse =
  | PingResponse
  | GraphResponse
  | ProfileResponse
  | GenerateMessageResponse
  | MarkSentResponse
  | ExportDataResponse
  | ImportDataResponse
  | ChatQueryResponse
  | ExtensionResponse<never>;

export function handleExternalMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<AnyResponse> {
  return respondToExternalMessage(message, sender);
}

async function respondToExternalMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<AnyResponse> {
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
    case 'GENERATE_MESSAGE': {
      const profile = await getProfileById(message.profileId);
      const user = await db.userProfile.get('me');
      if (!profile || !user) {
        return { ok: false, error: 'missing_data' };
      }
      const draft = await generateMessage(user, profile);
      await db.messages.add({
        id: crypto.randomUUID(),
        profileId: message.profileId,
        draft,
        context: profile.sharedSignals?.join(', ') ?? '',
        createdAt: Date.now(),
        sent: false,
      });
      return { ok: true, data: { draft } };
    }
    case 'MARK_SENT': {
      await db.messages.update(message.messageId, { sent: true });
      return { ok: true, data: null };
    }
    case 'EXPORT_DATA': {
      const profiles = await db.profiles.toArray();
      return { ok: true, data: { profiles } };
    }
    case 'IMPORT_DATA': {
      const user = (await db.userProfile.get('me')) ?? null;
      let imported = 0;
      for (const profile of message.profiles) {
        const scoredProfile = user ? applyWarmness(profile, user) : profile;
        await db.profiles.put(scoredProfile);
        imported++;
      }
      return { ok: true, data: { imported } };
    }
    case 'CHAT_QUERY': {
      const result = await chatQuery(message.question);
      return { ok: true, data: result };
    }
    default:
      return { ok: false, error: 'unsupported_message_type' };
  }
}
