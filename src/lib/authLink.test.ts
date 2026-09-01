import { describe, expect, it } from 'vitest';
import { parseAuthInput, redirectTarget } from './authLink';

const PROJECT = 'https://abcdefgh.supabase.co';

describe('what came in the email', () => {
  it('reads a six-digit code', () => {
    expect(parseAuthInput('123456')).toEqual({ kind: 'code', token: '123456' });
    expect(parseAuthInput('  123456  ')).toEqual({ kind: 'code', token: '123456' });
  });

  it('does not insist on exactly six digits', () => {
    expect(parseAuthInput('12345678')).toEqual({ kind: 'code', token: '12345678' });
  });

  it('reads the magic link straight out of the email', () => {
    const link = `${PROJECT}/auth/v1/verify?token=pkce_abc123&type=magiclink&redirect_to=https%3A%2F%2Fexample.com%2F`;
    expect(parseAuthInput(link)).toEqual({
      kind: 'link',
      tokenHash: 'pkce_abc123',
      type: 'magiclink',
    });
  });

  it('accepts the newer token_hash parameter too', () => {
    const link = `${PROJECT}/auth/v1/verify?token_hash=hash999&type=email`;
    expect(parseAuthInput(link)).toEqual({ kind: 'link', tokenHash: 'hash999', type: 'email' });
  });

  it('falls back to the email type when the link does not say', () => {
    expect(parseAuthInput(`${PROJECT}/auth/v1/verify?token=abc`)).toEqual({
      kind: 'link',
      tokenHash: 'abc',
      type: 'email',
    });
    // An unrecognised type is not passed through to Supabase verbatim.
    expect(parseAuthInput(`${PROJECT}/auth/v1/verify?token=abc&type=nonsense`)).toMatchObject({
      type: 'email',
    });
  });

  it('reads the session out of the URL you land on after following a link', () => {
    const landed = 'https://example.com/Workout-Tracer/#access_token=at123&refresh_token=rt456&expires_in=3600';
    expect(parseAuthInput(landed)).toEqual({
      kind: 'session',
      accessToken: 'at123',
      refreshToken: 'rt456',
    });
  });

  it('prefers the landed session over a token in the same URL', () => {
    const both = `https://example.com/?token=abc&type=email#access_token=at&refresh_token=rt`;
    expect(parseAuthInput(both)).toMatchObject({ kind: 'session' });
  });

  it('returns nothing for input it cannot act on', () => {
    for (const input of ['', '   ', 'hello', 'not a url', 'https://example.com/', '12']) {
      expect(parseAuthInput(input), input).toBeUndefined();
    }
  });
});

describe('where a link should come back to', () => {
  it('strips any query and fragment already on the page', () => {
    expect(redirectTarget('http://localhost:5173/?a=1#access_token=x')).toBe(
      'http://localhost:5173/',
    );
    expect(redirectTarget('https://example.com/Workout-Tracer/#/program')).toBe(
      'https://example.com/Workout-Tracer/',
    );
  });

  it('leaves something unparseable alone rather than throwing', () => {
    expect(redirectTarget('not a url')).toBe('not a url');
  });
});
