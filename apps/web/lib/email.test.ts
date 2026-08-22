import { describe, expect, it, vi } from "vitest";
import { deliver } from "./email";

const message = {
  from: "Paper Viewer <noreply@example.org>",
  to: "someone@example.com",
  subject: "Reset your Paper Viewer password",
  html: "<p>link</p>"
};

describe("deliver", () => {
  it("hands the provider the whole message, sender included", async () => {
    const send = vi.fn().mockResolvedValue({ error: null });

    await deliver(send, message);

    expect(send).toHaveBeenCalledWith(message);
  });

  it("reports success when the provider accepts", async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: "abc" }, error: null });

    await expect(deliver(send, message)).resolves.toBe(true);
  });

  it("reports failure when the provider resolves with an error", async () => {
    // The shape that matters. The Resend SDK rejects only when the request
    // never completed, and answers everything the API itself refused — bad
    // key, unverified sender, rate limit — with an error field on a resolved
    // promise. Watching only for a rejection is how a send that never
    // happened comes back looking like a success.
    const send = vi.fn().mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "The from address is not verified." }
    });

    await expect(deliver(send, message)).resolves.toBe(false);
  });

  it("reports failure, rather than raising, when the call rejects", async () => {
    // Every caller has already done the part that matters before reaching
    // here — the reset token is stored, the invitation row exists and its
    // link is about to be shown on screen. Throwing would lose exactly that.
    const send = vi.fn().mockRejectedValue(new Error("socket hang up"));

    await expect(deliver(send, message)).resolves.toBe(false);
  });
});
