import { describe, expect, it } from "vitest";
import { authErrorMessage } from "../src/lib/auth-errors";

describe("sign-in failure messages", () => {
  it("reports the observed SMTP failure as a service problem, not a bad address", () => {
    const message = authErrorMessage(
      { status: 500, code: "unexpected_failure", message: '535 "Incorrect authentication data"' },
      "send",
    );
    expect(message).toMatch(/email service is unavailable/);
    expect(message).not.toMatch(/check.*address|535|authentication data/i);
  });

  it("does not expose raw provider errors in either sign-in step", () => {
    for (const action of ["send", "verify"] as const) {
      const message = authErrorMessage({ message: "private-provider-detail@example.invalid" }, action);
      expect(message).not.toContain("private-provider-detail");
      expect(message).not.toContain("expired");
    }
  });

  it("asks throttled users to wait instead of immediately requesting more codes", () => {
    expect(authErrorMessage({ status: 429 }, "send")).toMatch(/Wait a minute/);
    expect(authErrorMessage({ code: "over_email_send_rate_limit" }, "send")).toMatch(/Wait a minute/);
  });

  it("only gives the expired-code guidance for a rejected OTP", () => {
    expect(authErrorMessage({ code: "otp_expired", status: 403 }, "verify")).toMatch(/latest email/);
    expect(authErrorMessage({ status: 500 }, "verify")).toMatch(/service is unavailable/);
    expect(authErrorMessage({ name: "AuthRetryableFetchError" }, "verify")).toMatch(/connection/);
  });
});
