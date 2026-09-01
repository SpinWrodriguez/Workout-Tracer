/* -------------------------------------------------------------------------- */
/*  What the sign-in email actually contains.                                 */
/*                                                                            */
/*  Supabase renders one template for signInWithOtp, so whether you receive a  */
/*  six-digit code or a magic link is a property of that template, not of the  */
/*  call. Rather than depend on it being configured one way, this accepts      */
/*  either: a code, the whole link pasted out of the email, or the URL you     */
/*  land on after following one.                                              */
/* -------------------------------------------------------------------------- */

/** The `type` values Supabase puts on an email verification link. */
export type EmailLinkType = 'email' | 'magiclink' | 'signup' | 'invite' | 'recovery';

const LINK_TYPES: EmailLinkType[] = ['email', 'magiclink', 'signup', 'invite', 'recovery'];

export type AuthInput =
  | { kind: 'code'; token: string }
  | { kind: 'link'; tokenHash: string; type: EmailLinkType }
  | { kind: 'session'; accessToken: string; refreshToken: string };

function asLinkType(value: string | null): EmailLinkType {
  return LINK_TYPES.includes(value as EmailLinkType) ? (value as EmailLinkType) : 'email';
}

/**
 * Works out what was pasted. Returns undefined when it is neither a code nor a
 * link this can do anything with, so the caller can say so plainly.
 */
export function parseAuthInput(raw: string): AuthInput | undefined {
  const input = raw.trim();
  if (input === '') return undefined;

  // A bare code: Supabase sends six digits, but do not hard-code the length.
  if (/^\d{4,8}$/.test(input)) return { kind: 'code', token: input };

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }

  // The URL you land on after following a link carries the session outright,
  // in the fragment rather than the query.
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  const accessToken = fragment.get('access_token');
  const refreshToken = fragment.get('refresh_token');
  if (accessToken && refreshToken) return { kind: 'session', accessToken, refreshToken };

  // The link straight out of the email: /auth/v1/verify?token=...&type=magiclink
  const params = url.searchParams;
  const tokenHash = params.get('token_hash') ?? params.get('token');
  if (tokenHash) {
    return { kind: 'link', tokenHash, type: asLinkType(params.get('type')) };
  }

  return undefined;
}

/** Where a magic link should come back to, so it lands on this app. */
export function redirectTarget(href: string): string {
  try {
    const url = new URL(href);
    // Drop any auth fragment or query already on it, or the round trip
    // compounds them.
    return `${url.origin}${url.pathname}`;
  } catch {
    return href;
  }
}
