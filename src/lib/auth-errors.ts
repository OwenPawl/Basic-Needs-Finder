/** Translate auth failures without exposing provider details or blaming a valid email. */
export function authErrorMessage(error: unknown, action: "send" | "verify") {
  const detail = error && typeof error === "object" ? error : {};
  const code = "code" in detail ? detail.code : undefined;
  const status = "status" in detail ? detail.status : undefined;
  const name = "name" in detail ? detail.name : undefined;

  if (
    status === 429 ||
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit"
  ) {
    return "Too many attempts. Wait a minute before trying again.";
  }
  if (code === "email_address_invalid" || code === "email_address_not_authorized") {
    return "Please check your email address and use an address you can receive mail at.";
  }
  if (action === "verify" && code === "otp_expired") {
    return "That code is invalid or has expired. Use the code from your latest email, or send a new one.";
  }
  if (name === "AuthRetryableFetchError" || name === "TypeError") {
    return "We couldn’t connect to sign-in. Check your connection and try again.";
  }
  if ((typeof status === "number" && status >= 500) || code === "unexpected_failure") {
    return action === "send"
      ? "The sign-in email service is unavailable right now. Please try again shortly."
      : "The sign-in service is unavailable right now. Please try again shortly.";
  }
  return action === "send"
    ? "We couldn’t send your sign-in code. Please try again shortly."
    : "We couldn’t verify your code. Check the complete code in your latest email and try again.";
}
