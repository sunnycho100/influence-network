import type { Profile } from '@alumni-graph/shared';

export type InternalExtensionMessage =
  | {
      type: 'UPSERT_SCRAPED_PROFILE';
      profile: Profile;
      url: string;
      startedAt: number;
      completedAt?: number;
    }
  | {
      type: 'SCRAPE_ERROR';
      route: 'profile' | 'search' | 'alumni' | 'unknown';
      url: string;
      error: string;
      startedAt: number;
      completedAt?: number;
      profileId?: string;
    };

export type InternalExtensionResponse<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export function isInternalExtensionMessage(message: unknown): message is InternalExtensionMessage {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const type = (message as { type?: unknown }).type;
  return type === 'UPSERT_SCRAPED_PROFILE' || type === 'SCRAPE_ERROR';
}
