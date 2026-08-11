import { prisma } from "@paper-viewer/db";
import { requireCurrentUser } from "@/lib/auth";
import { resolveLlmConfig, type LlmRuntimeConfig } from "@/lib/llm-config";
import { getPaperText } from "@/lib/paper-text";
import { z } from "zod";

const chatSchema = z.object({
  message: z.string().min(1).max(5000)
});

export async function POST(request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const { paperId } = await params;

  let llm: LlmRuntimeConfig;
  try {
    llm = await resolveLlmConfig(user.workspaceId);
  } catch {
    return Response.json({ error: "LLM 未配置，请在设置页配置" }, { status: 502 });
  }

  // Verify access
  const wp = await prisma.workspacePaper.findUnique({
    where: {
      workspaceId_paperId: {
        workspaceId: user.workspaceId,
        paperId
      }
    },
    include: { paper: true }
  });

  if (!wp) {
    return Response.json({ error: "Paper not found" }, { status: 404 });
  }

  const body = await request.json();
  const { message } = chatSchema.parse(body);

  // Get paper text content (全文优先，取不到时退回摘要/标题)
  const paperContent = (await getPaperText(paperId)) ?? wp.paper.abstract ?? wp.paper.title;

  // Save user message
  await prisma.paperChatMessage.create({
    data: { paperId, userId: user.id, role: "user", content: message }
  });

  // Get chat history
  const history = await prisma.paperChatMessage.findMany({
    where: { paperId, userId: user.id },
    orderBy: { createdAt: "asc" },
    take: 20 // last 20 messages for context
  });

  // Build messages for LLM
  const messages = [
    {
      role: "system",
      content: `你是一个学术论文阅读助手。以下是用户正在阅读的论文全文。请基于论文内容回答用户的问题，用通俗易懂的中文。如果用户问的问题在论文中找不到答案，请诚实说明。

论文标题：${wp.paper.title}

论文内容：
${paperContent.slice(0, 60000)}`
    },
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content
    }))
  ];

  // Stream response from LLM
  const response = await fetch(`${llm.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${llm.apiKey}`
    },
    body: JSON.stringify({
      model: llm.model,
      messages,
      max_tokens: 16000,
      stream: true
    })
  });

  if (!response.ok || !response.body) {
    return Response.json({ error: "LLM API error" }, { status: 502 });
  }

  // Transform SSE stream and collect full response
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));

          for (const line of lines) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data) as {
                choices: { delta: { content?: string; reasoning_content?: string } }[];
              };
              const content = parsed.choices[0]?.delta?.content;
              if (content) {
                fullContent += content;
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ content })}\n\n`));
              }
            } catch {
              // skip unparseable chunks
            }
          }
        }

        // Save assistant message
        if (fullContent) {
          await prisma.paperChatMessage.create({
            data: { paperId, userId: user.id, role: "assistant", content: fullContent }
          });
        }

        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  });
}

// GET: fetch chat history
export async function GET(_request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const { paperId } = await params;

  const messages = await prisma.paperChatMessage.findMany({
    where: { paperId, userId: user.id },
    orderBy: { createdAt: "asc" }
  });

  return Response.json({ messages });
}
