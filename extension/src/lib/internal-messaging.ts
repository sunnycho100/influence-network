import { recordProfileScrape, recordScrapeError } from './db';
import {
  isInternalExtensionMessage,
  type InternalExtensionMessage,
  type InternalExtensionResponse,
} from './runtime-messages';

export async function handleInternalMessage(
  message: unknown,
): Promise<InternalExtensionResponse<void>> {
  if (!isInternalExtensionMessage(message)) {
    return { ok: false, error: 'invalid_message' };
  }

  switch (message.type) {
    case 'UPSERT_SCRAPED_PROFILE':
      await recordProfileScrape({
        profile: message.profile,
        url: message.url,
        startedAt: message.startedAt,
        ...(message.completedAt ? { completedAt: message.completedAt } : {}),
      });
      return { ok: true };
    case 'SCRAPE_ERROR':
      await recordScrapeError({
        route: message.route,
        url: message.url,
        error: message.error,
        startedAt: message.startedAt,
        ...(message.completedAt ? { completedAt: message.completedAt } : {}),
        ...(message.profileId ? { profileId: message.profileId } : {}),
      });
      return { ok: true };
    default:
      return assertNever(message);
  }
}

function assertNever(message: never): InternalExtensionResponse<void> {
  return {
    ok: false,
    error: `unsupported_message_type:${JSON.stringify(message)}`,
  };
}
