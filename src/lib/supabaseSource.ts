import type { SupabaseClient } from '@supabase/supabase-js';
import { NUTRITION_TABLE, type WeightSource } from './remoteSync';
import { parseAuthInput, redirectTarget } from './authLink';

/* -------------------------------------------------------------------------- */
/*  Supabase wiring.                                                          */
/*                                                                            */
/*  The client is imported lazily. It is ~120 kB and nothing on the logging    */
/*  screen needs it, so it stays out of the app shell and loads when a sync or */
/*  a sign-in actually happens.                                                */
/*                                                                            */
/*  Session storage is left at the default localStorage, deliberately: served  */
/*  from the same origin as the nutrition app, this picks up the session that  */
/*  app already established and never asks for a code at all.                  */
/* -------------------------------------------------------------------------- */

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

let cached: Promise<SupabaseClient | undefined> | undefined;

export function getSupabase(): Promise<SupabaseClient | undefined> {
  if (!isSupabaseConfigured()) return Promise.resolve(undefined);
  cached ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string),
  );
  return cached;
}

/** Reads the signed-in user's nutrition row. */
export function supabaseSource(client: SupabaseClient): WeightSource {
  return {
    async userId() {
      const { data } = await client.auth.getSession();
      return data.session?.user.id;
    },
    async nutritionData(userId: string) {
      const { data, error } = await client
        .from(NUTRITION_TABLE)
        .select('data')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { data?: unknown } | null)?.data;
    },
  };
}

export interface SessionInfo {
  signedIn: boolean;
  email?: string;
}

export async function currentSession(): Promise<SessionInfo> {
  const client = await getSupabase();
  if (!client) return { signedIn: false };
  const { data } = await client.auth.getSession();
  return { signedIn: Boolean(data.session), email: data.session?.user.email ?? undefined };
}

/**
 * Asks Supabase to send a sign-in email. Whether that arrives as a six-digit
 * code or a magic link is decided by the project's email template, not here,
 * so the redirect is set for the link case and verifySignIn accepts both.
 */
export async function sendCode(email: string): Promise<string | undefined> {
  const client = await getSupabase();
  if (!client) return 'Supabase is not configured in this build.';
  const { error } = await client.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      // Only honoured if this URL is in the project's allowed redirects; when
      // it is not, the link still works by pasting it back in.
      emailRedirectTo: redirectTarget(window.location.href),
    },
  });
  return error?.message;
}

/**
 * Completes a sign-in from whatever the email produced: a code, the link
 * pasted whole, or the URL you were redirected to after following one.
 */
export async function verifySignIn(email: string, raw: string): Promise<string | undefined> {
  const client = await getSupabase();
  if (!client) return 'Supabase is not configured in this build.';

  const parsed = parseAuthInput(raw);
  if (!parsed) {
    return 'That is neither a code nor a sign-in link. Paste the code, or the whole link from the email.';
  }

  if (parsed.kind === 'code') {
    const { error } = await client.auth.verifyOtp({ email, token: parsed.token, type: 'email' });
    return error?.message;
  }

  if (parsed.kind === 'link') {
    const { error } = await client.auth.verifyOtp({
      token_hash: parsed.tokenHash,
      type: parsed.type,
    });
    return error?.message;
  }

  const { error } = await client.auth.setSession({
    access_token: parsed.accessToken,
    refresh_token: parsed.refreshToken,
  });
  return error?.message;
}

export async function signOut(): Promise<void> {
  const client = await getSupabase();
  await client?.auth.signOut();
}
