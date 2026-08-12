/**
 * Feishu (Lark) custom bot webhook: building and delivering the daily digest card.
 *
 * The card uses the interactive structure of "message card v1", with a request
 * body shaped like `{"msg_type":"interactive","card":{...}}`. A success response
 * is `{"code":0,...}` (older gateways return `{"StatusCode":0}`); on failure the
 * code is a non-zero business error code.
 */

export type DigestPaper = {
  id: string;
  title: string;
  summaryLine: string;
};

export type DigestCardInput = {
  /** YYYY-MM-DD */
  date: string;
  /** Chinese overview; may be an empty string (in which case no blank paragraph is generated) */
  overview: string;
  papers: DigestPaper[];
  /** Site root address, with or without a trailing slash */
  appUrl: string;
};

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
/** Exponential backoff: wait 1s after the first failure, 2s after the second, and give up outright after the third */
const RETRY_DELAY_MS = [1_000, 2_000];

function stripTrailingSlashes(appUrl: string): string {
  return appUrl.replace(/\/+$/, "");
}

/**
 * A `[` / `]` inside a paper title cuts the lark_md link syntax in half
 * (`[SAM [v2] model](url)` renders as bare text), so they are escaped to
 * `\[` / `\]`.
 */
function escapeLinkText(title: string): string {
  return title.replace(/[[\]]/g, "\\$&");
}

function paperElement(paper: DigestPaper, index: number, appUrl: string) {
  const link = `${appUrl}/papers/${paper.id}`;
  return {
    tag: "div",
    text: {
      tag: "lark_md",
      content: `**${index + 1}. [${escapeLinkText(paper.title)}](${link})**\n${paper.summaryLine}`
    }
  };
}

export function buildDigestCard(input: DigestCardInput): object {
  const appUrl = stripTrailingSlashes(input.appUrl);
  const overview = input.overview.trim();

  const overviewElements = overview
    ? [{ tag: "div", text: { tag: "lark_md", content: overview } }]
    : [];
  const paperElements = input.papers.map((paper, index) => paperElement(paper, index, appUrl));

  return {
    config: { wide_screen_mode: true },
    header: {
      template: "blue",
      title: {
        tag: "plain_text",
        content: `📄 今日论文 · ${input.papers.length} 篇（${input.date}）`
      }
    },
    elements: [...overviewElements, ...paperElements]
  };
}

/** Minimal card used by the settings page's "send test" button; contains no paper data. */
export function buildTestCard(): object {
  return {
    config: { wide_screen_mode: true },
    header: {
      template: "blue",
      title: { tag: "plain_text", content: "Paper Viewer" }
    },
    elements: [
      {
        tag: "div",
        text: { tag: "lark_md", content: "测试消息发送成功 ✓ / Test message from Paper Viewer" }
      }
    ]
  };
}

/** A non-JSON response body is not a failure — as long as the HTTP status is 200, treat the gateway as having accepted the card. */
async function readPayload(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await response.json();
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function assertAccepted(payload: Record<string, unknown> | null): void {
  if (!payload) return;
  const code = payload["code"] ?? payload["StatusCode"];
  // Neither field present: the trimmed-down success response of an old gateway,
  // treated as success.
  if (code === undefined || code === 0) return;
  throw new Error(`feishu rejected the card: code=${String(code)} msg=${String(payload["msg"] ?? "")}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export type SendFeishuCardOptions = {
  /** Backoff implementation; tests inject a zero delay so they do not actually wait. */
  delay?: (ms: number) => Promise<void>;
};

/**
 * Deliver the card, with at most 3 attempts. Any exception is swallowed and
 * logged under `[feishu]` — a failed push should not fail the digest pipeline as
 * a whole, so this function never throws.
 */
export async function sendFeishuCard(
  webhookUrl: string,
  card: object,
  options: SendFeishuCardOptions = {}
): Promise<boolean> {
  const delay = options.delay ?? sleep;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ msg_type: "interactive", card }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });

      if (!response.ok) {
        throw new Error(`feishu webhook responded ${response.status}`);
      }

      assertAccepted(await readPayload(response));
      return true;
    } catch (error) {
      console.error("[feishu]", `attempt ${attempt}/${MAX_ATTEMPTS} failed:`, error);
      const backoff = RETRY_DELAY_MS[attempt - 1];
      if (backoff !== undefined && attempt < MAX_ATTEMPTS) {
        await delay(backoff);
      }
    }
  }

  return false;
}
