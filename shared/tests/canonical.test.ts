import { describe, expect, it } from 'vitest';
import { canonicalSchool } from '../src/canonical';

describe('canonicalSchool', () => {
  it('returns empty string for missing input', () => {
    expect(canonicalSchool()).toBe('');
    expect(canonicalSchool('')).toBe('');
    expect(canonicalSchool('   ')).toBe('');
  });

  it('collapses dash variants to the same key', () => {
    const a = canonicalSchool('University of Wisconsin-Madison');
    const b = canonicalSchool('University of Wisconsin\u2013Madison'); // en dash
    const c = canonicalSchool('University of Wisconsin\u2014Madison'); // em dash
    expect(a).toBe('madison wisconsin');
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('expands UW abbreviations to match the full name', () => {
    const full = canonicalSchool('University of Wisconsin-Madison');
    expect(canonicalSchool('UW-Madison')).toBe(full);
    expect(canonicalSchool('UW Madison')).toBe(full);
    expect(canonicalSchool('uw–madison')).toBe(full);
  });

  it('strips generic stopwords like "university" and "of"', () => {
    expect(canonicalSchool('Stanford University')).toBe('stanford');
    expect(canonicalSchool('Stanford')).toBe('stanford');
    expect(canonicalSchool('The University of Texas at Austin')).toBe('austin texas');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(canonicalSchool('  MIT  ')).toBe('mit');
    expect(canonicalSchool('mit')).toBe('mit');
  });

  it('keeps distinct schools distinct', () => {
    expect(canonicalSchool('University of Wisconsin-Milwaukee')).not.toBe(
      canonicalSchool('University of Wisconsin-Madison'),
    );
    expect(canonicalSchool('UWM')).toBe(canonicalSchool('University of Wisconsin-Milwaukee'));
  });
});
