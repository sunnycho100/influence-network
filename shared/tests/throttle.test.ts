import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We can't import throttle.ts directly because it uses module-level state.
// Instead, we'll test the logic by dynamically importing it in each test.

// Inline the throttle logic for unit testing (avoids chrome dependencies)
describe('throttle logic', () => {
  const THROTTLE_WINDOW_MS = 60_000;
  const MAX_SCRAPES_PER_WINDOW = 15;
  const MIN_DELAY_BETWEEN_MS = 2_000;

  let timestamps: number[];
  let now: number;

  beforeEach(() => {
    timestamps = [];
    now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function pruneOldTimestamps() {
    const cutoff = Date.now() - THROTTLE_WINDOW_MS;
    while (timestamps.length > 0 && (timestamps[0] ?? 0) <= cutoff) {
      timestamps.shift();
    }
  }

  function canScrape(): boolean {
    pruneOldTimestamps();
    if (timestamps.length >= MAX_SCRAPES_PER_WINDOW) return false;
    const lastTs = timestamps[timestamps.length - 1];
    if (lastTs && Date.now() - lastTs < MIN_DELAY_BETWEEN_MS) return false;
    return true;
  }

  function recordScrape(): void {
    timestamps.push(Date.now());
  }

  function timeUntilNextScrape(): number {
    pruneOldTimestamps();
    if (timestamps.length >= MAX_SCRAPES_PER_WINDOW) {
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

  it('allows the first scrape immediately', () => {
    expect(canScrape()).toBe(true);
    expect(timeUntilNextScrape()).toBe(0);
  });

  it('blocks scrapes within the minimum delay', () => {
    recordScrape();
    expect(canScrape()).toBe(false);
    expect(timeUntilNextScrape()).toBe(MIN_DELAY_BETWEEN_MS);

    vi.advanceTimersByTime(1_000);
    expect(canScrape()).toBe(false);
    expect(timeUntilNextScrape()).toBe(1_000);
  });

  it('allows scrape after minimum delay passes', () => {
    recordScrape();
    vi.advanceTimersByTime(MIN_DELAY_BETWEEN_MS);
    expect(canScrape()).toBe(true);
    expect(timeUntilNextScrape()).toBe(0);
  });

  it('blocks after max scrapes per window', () => {
    for (let i = 0; i < MAX_SCRAPES_PER_WINDOW; i++) {
      recordScrape();
      vi.advanceTimersByTime(MIN_DELAY_BETWEEN_MS);
    }
    expect(canScrape()).toBe(false);
  });

  it('allows scrape after oldest timestamp exits the window', () => {
    for (let i = 0; i < MAX_SCRAPES_PER_WINDOW; i++) {
      recordScrape();
      vi.advanceTimersByTime(MIN_DELAY_BETWEEN_MS);
    }
    expect(canScrape()).toBe(false);

    // Advance enough for the first timestamp to expire
    const remaining = timeUntilNextScrape();
    vi.advanceTimersByTime(remaining);
    expect(canScrape()).toBe(true);
  });

  it('prunes old timestamps correctly', () => {
    recordScrape();
    vi.advanceTimersByTime(THROTTLE_WINDOW_MS + 1);
    pruneOldTimestamps();
    expect(timestamps).toHaveLength(0);
    expect(canScrape()).toBe(true);
  });

  it('timeUntilNextScrape returns 0 when no scrapes recorded', () => {
    expect(timeUntilNextScrape()).toBe(0);
  });
});
