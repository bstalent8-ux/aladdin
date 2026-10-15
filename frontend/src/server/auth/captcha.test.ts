import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CAPTCHA_FIELD, CAPTCHA_SESSION_FIELD, captchaTokenFrom, isCaptchaFailure } from "./captcha";

function form(entries: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("captchaTokenFrom", () => {
  it("reads the default and the session field independently", () => {
    const data = form({ [CAPTCHA_FIELD]: "token-a", [CAPTCHA_SESSION_FIELD]: "token-b" });
    expect(captchaTokenFrom(data)).toBe("token-a");
    expect(captchaTokenFrom(data, CAPTCHA_SESSION_FIELD)).toBe("token-b");
  });

  it("trims the token", () => {
    expect(captchaTokenFrom(form({ captchaToken: "  abc  " }))).toBe("abc");
  });

  it.each([["absent", {}], ["empty", { captchaToken: "" }], ["blank", { captchaToken: "   " }]])("treats %s as missing", (_label, entries) => {
    expect(captchaTokenFrom(form(entries))).toBeNull();
  });

  it("treats a file upload as missing", () => {
    expect(captchaTokenFrom(form({ captchaToken: new File(["x"], "x.txt") }))).toBeNull();
  });

  it("treats an oversized token (>2048) as missing, and 2048 as acceptable", () => {
    expect(captchaTokenFrom(form({ captchaToken: "x".repeat(2049) }))).toBeNull();
    expect(captchaTokenFrom(form({ captchaToken: "x".repeat(2048) }))).toHaveLength(2048);
  });
});

describe("isCaptchaFailure", () => {
  it("recognises GoTrue's captcha_failed code", () => {
    expect(isCaptchaFailure({ code: "captcha_failed" })).toBe(true);
  });
  it.each([
    "captcha protection: request disallowed (timeout-or-duplicate)",
    "captcha protection: request disallowed (no captcha_token found)",
  ])("recognises the message %p when the code is absent", (message) => {
    expect(isCaptchaFailure({ message })).toBe(true);
  });
  it.each([
    [{ code: "over_email_send_rate_limit" }],
    [{ code: "invalid_credentials", message: "Invalid login credentials" }],
    [{ message: "network blip" }],
    [{}],
    [null],
    [undefined],
  ])("does not mistake %p for a captcha failure", (error) => {
    expect(isCaptchaFailure(error as never)).toBe(false);
  });
});
