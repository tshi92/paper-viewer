import { prisma } from "@paper-viewer/db";
import { requireCurrentUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { z } from "zod";

const chatSchema = z.object({
  message: z.string().min(1).max(5000)
});

async function ensurePaperExtract(paperId: string, env: { LLM_API_KEY: string; LLM_BASE_URL: string }): Promise<string> {
  // Check if we already have extracted text
  const existing = await prisma.paperFileExtract.findUnique({
    where: { paperId }
  });
  if (existing) return existing.textContent;

  // Get paper info to find PDF source
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    include: { files: { take: 1 } }
  });

  if (!paper) throw new Error("Paper not found");

  let pdfBytes: Uint8Array | null = null;

  // Try to get PDF from arXiv if available
  if (paper.arxivId) {
    const res = await fetch(`https://arxiv.org/pdf/${paper.arxivId}`, {
      headers: { "User-Agent": "PaperViewer/1.0" }
    });
    if (res.ok) {
      pdfBytes = new Uint8Array(await res.arrayBuffer());
    }
  }

  if (!pdfBytes) {
    // Fallback: use abstract as context
    return paper.abstract ?? paper.title;
  }

  // Upload to Kimi Files API
  const uploadForm = new FormData();
  uploadForm.append("file", new Blob([Buffer.from(pdfBytes)], { type: "application/pdf" }), `${paper.arxivId ?? paperId}.pdf`);
  uploadForm.append("purpose", "file-extract");

  const uploadRes = await fetch(`${env.LLM_BASE_URL}/files`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.LLM_API_KEY}` },
    body: uploadForm
  });

  if (!uploadRes.ok) {
    return paper.abstract ?? paper.title;
  }

  const fileData = await uploadRes.json() as { id: string };

  // Get extracted text
  const contentRes = await fetch(`${env.LLM_BASE_URL}/files/${fileData.id}/content`, {
    headers: { "Authorization": `Bearer ${env.LLM_API_KEY}` }
  });

  const textContent = contentRes.ok ? await contentRes.text() : (paper.abstract ?? paper.title);

  // Cache it
  await prisma.paperFileExtract.create({
    data: {
      paperId,
      llmFileId: fileData.id,
      textContent: textContent.slice(0, 100000) // limit storage
    }
  });

  return textContent;
}

export async function POST(request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const env = getEnv();
  const { paperId } = await params;

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

  // Get paper text content
  let paperContent: string;
  try {
    paperContent = await ensurePaperExtract(paperId, env);
  } catch {
    paperContent = wp.paper.abstract ?? wp.paper.title;
  }

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
  const response = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.LLM_API_KEY}`
    },
    body: JSON.stringify({
      model: env.LLM_MODEL,
      messages,
      temperature: 0.3,
      max_tokens: 4000,
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
                choices: { delta: { content?: string } }[];
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
