import type {
  ChatCitation,
  ExtensionMessage,
  ExtensionResponse,
  GraphSnapshot,
  Profile,
} from '@alumni-graph/shared';

const extensionId = import.meta.env.VITE_EXTENSION_ID?.trim() ?? '';

function getExtensionId(): string {
  if (!extensionId) {
    throw new Error('VITE_EXTENSION_ID is not set');
  }

  return extensionId;
}

function send<T>(message: ExtensionMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      reject(new Error('Chrome extension messaging is unavailable in this browser'));
      return;
    }

    try {
      chrome.runtime.sendMessage(
        getExtensionId(),
        message,
        (response) => {
          const payload = response as ExtensionResponse<T> | undefined;

          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message ?? 'Extension request failed'));
            return;
          }

          if (!payload) {
            reject(new Error('No response received from the extension'));
            return;
          }

          if (!payload.ok) {
            reject(new Error(payload.error));
            return;
          }

          resolve(payload.data);
        }
      );
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Unknown extension error'));
    }
  });
}

export const extensionClient = {
  ping: () => send<{ version: string }>({ type: 'PING' }),
  getGraph: () => send<GraphSnapshot>({ type: 'GET_GRAPH' }),
  generateMessage: (profileId: string) =>
    send<{ draft: string }>({ type: 'GENERATE_MESSAGE', profileId }),
  markSent: (messageId: string) =>
    send<null>({ type: 'MARK_SENT', messageId }),
  exportData: () =>
    send<{ profiles: Profile[] }>({ type: 'EXPORT_DATA' }),
  importData: (profiles: Profile[]) =>
    send<{ imported: number }>({ type: 'IMPORT_DATA', profiles }),
  chatQuery: (question: string) =>
    send<{ answer: string; citations: ChatCitation[]; usedLlm: boolean }>({
      type: 'CHAT_QUERY',
      question,
    }),
};
