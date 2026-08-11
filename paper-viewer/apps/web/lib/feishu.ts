/**
 * 飞书（Lark）自定义机器人 webhook：每日 digest 卡片的构建与投递。
 *
 * 卡片格式为「消息卡片 v1」的 interactive 结构，请求体形如
 * `{"msg_type":"interactive","card":{...}}`。成功响应是 `{"code":0,...}`
 * （旧版网关返回 `{"StatusCode":0}`），失败时 code 为非零业务错误码。
 */

export type DigestPaper = {
  id: string;
  title: string;
  summaryLine: string;
};

export type DigestCardInput = {
  /** YYYY-MM-DD */
  date: string;
  /** 中文总览，可为空串（空串时不生成空白段落） */
  overview: string;
  papers: DigestPaper[];
  /** 站点根地址，带不带尾斜杠都可以 */
  appUrl: string;
};

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
/** 指数退避：第 1 次失败等 1s，第 2 次等 2s，第 3 次失败直接放弃 */
const RETRY_DELAY_MS = [1_000, 2_000];

function stripTrailingSlashes(appUrl: string): string {
  return appUrl.replace(/\/+$/, "");
}

/**
 * 论文标题里的 `[` / `]` 会把 lark_md 链接语法从中间截断
 * （`[SAM [v2] model](url)` 渲染成裸文本），因此转义成 `\[` / `\]`。
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

/** 设置页「发送测试」用的最小卡片，不含论文数据。 */
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

/** 非 JSON 响应体不算失败——只要 HTTP 200，就当作网关接受了卡片。 */
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
  // 两个字段都没有：老网关的精简成功响应，视为成功。
  if (code === undefined || code === 0) return;
  throw new Error(`feishu rejected the card: code=${String(code)} msg=${String(payload["msg"] ?? "")}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export type SendFeishuCardOptions = {
  /** 退避实现，测试注入零延迟以免真的等待。 */
  delay?: (ms: number) => Promise<void>;
};

/**
 * 投递卡片，最多尝试 3 次。任何异常都被吞掉并记 `[feishu]` 日志——
 * 推送失败不应该让 digest 管道整体失败，所以本函数永不抛出。
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
