import { afterEach, describe, expect, it, vi } from "vitest";
import { errorCode, supabaseConfig } from "../src/lib/supabase";

afterEach(() => vi.unstubAllEnvs());

describe("supabase client config", () => {
  it("is unavailable without a URL and publishable key", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(supabaseConfig()).toBeNull();
  });

  it("requires https and falls back to the anon key name", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://example.supabase.co");
    expect(supabaseConfig()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    expect(supabaseConfig()).toEqual({
      url: "https://example.supabase.co",
      key: "anon-key",
    });
  });

  it("reads API_CONTRACT codes from RPC errors only", () => {
    expect(errorCode({ message: "FORBIDDEN" })).toBe("FORBIDDEN");
    expect(errorCode({ message: "permission denied for table" })).toBe(
      undefined,
    );
    expect(errorCode(null)).toBe(undefined);
  });
});
