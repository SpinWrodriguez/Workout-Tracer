import type { SupabaseClient } from '@supabase/supabase-js';
import { NUTRITION_TABLE, type WeightSource } from './remoteSync';

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

/** Email OTP, matching the nutrition app — magic links break the PWA flow. */
export async function sendCode(email: string): Promise<string | undefined> {
  const client = await getSupabase();
  if (!client) return 'Supabase is not configured in this build.';
  const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  return error?.message;
}

export async function verifyCode(email: string, token: string): Promise<string | undefined> {
  const client = await getSupabase();
  if (!client) return 'Supabase is not configured in this build.';
  const { error } = await client.auth.verifyOtp({ email, token, type: 'email' });
  return error?.message;
}

export async function signOut(): Promise<void> {
  const client = await getSupabase();
  await client?.auth.signOut();
}
