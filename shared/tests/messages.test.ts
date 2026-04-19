import { describe, it, expect } from 'vitest';
import { isExtensionMessage, isAllowedOrigin } from '../src/messages';

describe('isExtensionMessage', () => {
  it('accepts all valid message types', () => {
    expect(isExtensionMessage({ type: 'PING' })).toBe(true);
    expect(isExtensionMessage({ type: 'GET_GRAPH' })).toBe(true);
    expect(isExtensionMessage({ type: 'GET_PROFILE', profileId: 'abc' })).toBe(true);
    expect(isExtensionMessage({ type: 'GENERATE_MESSAGE', profileId: 'abc' })).toBe(true);
    expect(isExtensionMessage({ type: 'MARK_SENT', messageId: 'x' })).toBe(true);
    expect(isExtensionMessage({ type: 'EXPORT_DATA' })).toBe(true);
    expect(isExtensionMessage({ type: 'IMPORT_DATA', profiles: [] })).toBe(true);
  });

  it('rejects invalid inputs', () => {
    expect(isExtensionMessage(null)).toBe(false);
    expect(isExtensionMessage(undefined)).toBe(false);
    expect(isExtensionMessage('')).toBe(false);
    expect(isExtensionMessage(42)).toBe(false);
    expect(isExtensionMessage({})).toBe(false);
    expect(isExtensionMessage({ type: 'UNKNOWN' })).toBe(false);
    expect(isExtensionMessage({ type: '' })).toBe(false);
    expect(isExtensionMessage({ action: 'PING' })).toBe(false);
  });
});

describe('isAllowedOrigin', () => {
  it('accepts allowed origins', () => {
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173/')).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173/some/path')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:5173')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:5173/page')).toBe(true);
    expect(isAllowedOrigin('https://alumni-graph.vercel.app')).toBe(true);
    expect(isAllowedOrigin('https://alumni-graph.vercel.app/')).toBe(true);
    expect(isAllowedOrigin('https://alumni-graph.vercel.app/dashboard')).toBe(true);
  });

  it('rejects disallowed origins', () => {
    expect(isAllowedOrigin('http://localhost:3000')).toBe(false);
    expect(isAllowedOrigin('https://evil-site.com')).toBe(false);
    expect(isAllowedOrigin('https://alumni-graph.vercel.app.evil.com')).toBe(false);
    expect(isAllowedOrigin('http://localhost:5173.evil.com')).toBe(false);
    expect(isAllowedOrigin('')).toBe(false);
    expect(isAllowedOrigin(undefined)).toBe(false);
  });

  it('handles malformed URLs gracefully', () => {
    expect(isAllowedOrigin('not-a-url')).toBe(false);
    expect(isAllowedOrigin('://missing-scheme')).toBe(false);
  });
});
