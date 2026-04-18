import { scrapeProfilePage } from './scrapers/profile-page';

import type { InternalExtensionMessage, InternalExtensionResponse } from '../lib/runtime-messages';

const PROFILE_URL_PATTERN = /linkedin\.com\/in\/[^/?#]+\/?(?:[?#].*)?$/i;
const SCRAPE_DELAYS_MS = [250, 1200, 3200];

let lastObservedUrl = location.href;
let lastSuccessfulProfileUrl = '';
let activeRouteToken = 0;
let retryTimerId: number | undefined;

patchHistoryEvents();
window.addEventListener('alumnigraph:navigation', () => scheduleRouteHandling('navigation'));
window.addEventListener('popstate', () => scheduleRouteHandling('popstate'));

const observer = new MutationObserver(() => {
  if (location.href !== lastObservedUrl) {
    lastObservedUrl = location.href;
    scheduleRouteHandling('mutation:url-change');
    return;
  }

  if (isProfileUrl(location.href) && lastSuccessfulProfileUrl !== location.href) {
    scheduleRetry();
  }
});

observer.observe(document, {
  subtree: true,
  childList: true,
});

scheduleRouteHandling('initial-load');

function scheduleRouteHandling(_reason: string): void {
  lastObservedUrl = location.href;
  lastSuccessfulProfileUrl = '';
  activeRouteToken += 1;

  for (const delay of SCRAPE_DELAYS_MS) {
    window.setTimeout(() => {
      if (activeRouteToken && location.href === lastObservedUrl) {
        void handleRoute(location.href, activeRouteToken);
      }
    }, delay);
  }
}

function scheduleRetry(): void {
  if (retryTimerId) {
    window.clearTimeout(retryTimerId);
  }

  retryTimerId = window.setTimeout(() => {
    void handleRoute(location.href, activeRouteToken);
  }, 700);
}

async function handleRoute(url: string, routeToken: number): Promise<void> {
  if (routeToken !== activeRouteToken || !isProfileUrl(url)) {
    return;
  }

  const startedAt = Date.now();

  try {
    const profile = scrapeProfilePage(document);
    if (!profile) {
      return;
    }

    await sendInternalMessage({
      type: 'UPSERT_SCRAPED_PROFILE',
      profile,
      url,
      startedAt,
      completedAt: Date.now(),
    });

    lastSuccessfulProfileUrl = url;
  } catch (error) {
    const profileId = extractProfileId(url);

    await sendInternalMessage({
      type: 'SCRAPE_ERROR',
      route: 'profile',
      url,
      error: error instanceof Error ? error.message : 'Unknown scrape failure',
      startedAt,
      completedAt: Date.now(),
      ...(profileId ? { profileId } : {}),
    });
  }
}

function isProfileUrl(url: string): boolean {
  return PROFILE_URL_PATTERN.test(url);
}

function extractProfileId(url: string): string | null {
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match?.[1] ?? null;
}

function sendInternalMessage(
  message: InternalExtensionMessage,
): Promise<InternalExtensionResponse<void>> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: InternalExtensionResponse<void> | undefined) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message ?? 'Background request failed'));
        return;
      }

      if (!response) {
        reject(new Error('Missing background response'));
        return;
      }

      if (!response.ok) {
        reject(new Error(response.error));
        return;
      }

      resolve(response);
    });
  });
}

function patchHistoryEvents(): void {
  const pushState = history.pushState.bind(history);
  const replaceState = history.replaceState.bind(history);

  history.pushState = (...args) => {
    pushState(...args);
    window.dispatchEvent(new Event('alumnigraph:navigation'));
  };

  history.replaceState = (...args) => {
    replaceState(...args);
    window.dispatchEvent(new Event('alumnigraph:navigation'));
  };
}
