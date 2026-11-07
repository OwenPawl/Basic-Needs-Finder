import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Browser-only Supabase client for the static GitHub Pages build. It uses the
// publishable (anon) key only; service-role keys never belong in the frontend.
// Returns null when the build has no Supabase configuration, so pages can show
// an explicit "live accounts aren't connected" state instead of failing.

let client: SupabaseClient | null | undefined;

export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )?.trim();
  if (!url || !key || !/^https:\/\//.test(url)) return null;
  return { url, key };
}

export function getSupabaseClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  if (typeof window === "undefined") return null;
  const config = supabaseConfig();
  client = config
    ? createClient(config.url, config.key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      })
    : null;
  return client;
}

/** API_CONTRACT error code from a PostgREST/RPC error, if it carries one. */
export function errorCode(error: unknown): string | undefined {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : "";
  return /^[A-Z_]+$/.test(message) ? message : undefined;
}
