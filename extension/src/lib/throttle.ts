/* ---------------------------------------------------------------------------
 * Scrape throttle — rate-limits how frequently profiles are upserted
 * to avoid hammering LinkedIn or triggering anti-bot defenses.
 * -------------------------------------------------------------------------*/

const THROTTLE_WINDOW_MS = 60_000;       // 1 minute window
const MAX_SCRAPES_PER_WINDOW = 15;       // max 15 profiles per minute
const MIN_DELAY_BETWEEN_MS = 2_000;      // at least 2s between scrapes

const timestamps: number[] = [];

/**
 * Returns true if a scrape is allowed right now.
 * Call `recordScrape()` after a successful scrape.
 */
export function canScrape(): boolean {
  pruneOldTimestamps();

  if (timestamps.length >= MAX_SCRAPES_PER_WINDOW) return false;

  const lastTs = timestamps[timestamps.length - 1];
  if (lastTs && Date.now() - lastTs < MIN_DELAY_BETWEEN_MS) return false;

  return true;
}

/**
 * Record that a scrape just happened.
 */
export function recordScrape(): void {
  timestamps.push(Date.now());
}

/**
 * Time until the next scrape is allowed (ms). Returns 0 if allowed now.
 */
export function timeUntilNextScrape(): number {
  pruneOldTimestamps();

  if (timestamps.length >= MAX_SCRAPES_PER_WINDOW) {
    // Wait until the oldest entry in the window expires
    const oldest = timestamps[0];
    return oldest ? oldest + THROTTLE_WINDOW_MS - Date.now() : 0;
  }

  const lastTs = timestamps[timestamps.length - 1];
  if (lastTs) {
    const elapsed = Date.now() - lastTs;
    return elapsed < MIN_DELAY_BETWEEN_MS ? MIN_DELAY_BETWEEN_MS - elapsed : 0;
  }

  return 0;
}

function pruneOldTimestamps(): void {
  const cutoff = Date.now() - THROTTLE_WINDOW_MS;
  while (timestamps.length > 0 && (timestamps[0] ?? 0) <= cutoff) {
    timestamps.shift();
  }
}
