import { Resend } from "resend";
import { getEnv } from "@/lib/env";

/**
 * Outgoing mail: invitation links and password-reset links.
 *
 * Mail is a convenience here, never the thing itself. An invitation's real
 * delivery channel is the link shown on the members page for the inviter to
 * pass on, and a reset token is stored before anything is sent. So sending
 * reports a failure rather than raising one — see `deliver`.
 */
export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
};

/** What a provider hands back. Resend answers a refused send this way rather than by rejecting. */
export type EmailSendResult = { error?: unknown };

export type EmailSender = (message: EmailMessage & { from: string }) => Promise<EmailSendResult>;

/**
 * Sends a message and says whether it left the building.
 *
 * Two failure shapes have to fold into one answer. The Resend SDK rejects only
 * when the request never completed — DNS, timeout, a dead socket — and for
 * everything the API itself refused (bad key, unverified sender, rate limit)
 * it resolves with an `error` field instead. Watching for only one of the two
 * is how a send that never happened comes back looking like a success.
 *
 * The recipient stays out of the log line. This runs on a path anyone can
 * reach without logging in, and a log of addresses that asked for a reset is a
 * list of addresses that have accounts.
 */
export async function deliver(
  send: EmailSender,
  message: EmailMessage & { from: string }
): Promise<boolean> {
  let result: EmailSendResult;

  try {
    result = await send(message);
  } catch (error) {
    console.error("[email] send failed to complete", { subject: message.subject, error });
    return false;
  }

  if (result.error) {
    console.error("[email] provider refused the send", {
      subject: message.subject,
      error: result.error
    });
    return false;
  }

  return true;
}

/**
 * Sends through the configured provider, or reports failure when there is
 * none. A deployment with no mail provider is a supported configuration, not
 * an error: every flow that sends mail also works without it.
 */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  const env = getEnv();

  if (!env.RESEND_API_KEY) {
    return false;
  }

  const resend = new Resend(env.RESEND_API_KEY);
  return deliver((payload) => resend.emails.send(payload), { ...message, from: env.EMAIL_FROM });
}
