"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CopyTextButton } from "./copy-text-button";
import { MarkdownBody } from "./markdown-body";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

/** Per-message state of the "save to comments" action. */
type SaveState = "saving" | "saved" | "failed";

/** The comments API rejects bodies above this length. */
const MAX_COMMENT_LENGTH = 5000;

/** Chat replies are rarely this long; truncating beats losing the save outright. */
function toCommentBody(content: string): string {
  if (content.length <= MAX_COMMENT_LENGTH) return content;
  return `${content.slice(0, MAX_COMMENT_LENGTH - 1)}…`;
}

export function PaperChat({ paperId }: { paperId: string }) {
  const t = useTranslations("chat");
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shouldAutoScroll = useRef(false);

  // Load chat history
  useEffect(() => {
    fetch(`/api/papers/${paperId}/chat`)
      .then((r) => r.json())
      .then((data: { messages: ChatMessage[] }) => setMessages(data.messages))
      .catch(() => {});
  }, [paperId]);

  useEffect(() => {
    if (!shouldAutoScroll.current) return;
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setLoading(true);
    setStreaming("");
    shouldAutoScroll.current = true;

    // Optimistic add user message
    const userMsg: ChatMessage = { id: `temp-${Date.now()}`, role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch(`/api/papers/${paperId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text })
      });

      if (!res.ok || !res.body) {
        setStreaming(t("errorResponse"));
        setLoading(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));

        for (const line of lines) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data) as { content: string };
            fullContent += parsed.content;
            setStreaming(fullContent);
          } catch {
            // skip
          }
        }
      }

      // Replace streaming with final message
      if (fullContent) {
        setMessages((prev) => [
          ...prev,
          { id: `assistant-${Date.now()}`, role: "assistant", content: fullContent }
        ]);
      }
      setStreaming("");
    } catch {
      setStreaming(t("errorNetwork"));
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, paperId, t]);

  const saveToComments = useCallback(
    async (messageId: string, content: string) => {
      setSaveStates((prev) => ({ ...prev, [messageId]: "saving" }));
      try {
        const res = await fetch(`/api/papers/${paperId}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: toCommentBody(content) })
        });
        if (!res.ok) throw new Error("save failed");
        setSaveStates((prev) => ({ ...prev, [messageId]: "saved" }));
        // Comments reach the workspace as server props, so the panel and the tab
        // count only pick the new one up after a server re-render.
        router.refresh();
      } catch {
        setSaveStates((prev) => ({ ...prev, [messageId]: "failed" }));
      }
    },
    [paperId, router]
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <section className="flex h-full min-w-0 flex-col rounded border border-border bg-white shadow-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-semibold">{t("heading")}</h2>
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !streaming ? (
          <div className="text-center text-sm text-muted py-8">
            <p>{t("emptyTitle")}</p>
            <div className="mt-3 space-y-1 text-xs">
              <p className="text-muted">{t("emptyTryLabel")}</p>
              <p>&ldquo;{t("emptySuggestionContribution")}&rdquo;</p>
              <p>&ldquo;{t("emptySuggestionMethod")}&rdquo;</p>
              <p>&ldquo;{t("emptySuggestionLimitations")}&rdquo;</p>
            </div>
          </div>
        ) : null}

        {messages.map((msg) => {
          const saveState = saveStates[msg.id];
          return (
            <div key={msg.id} className={msg.role === "user" ? "flex justify-end" : undefined}>
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  msg.role === "user"
                    ? "bg-accent text-white"
                    : "bg-surface text-ink"
                }`}
              >
                {/* Replies come back as markdown; what the user typed is left alone. */}
                {msg.role === "assistant" ? (
                  <MarkdownBody>{msg.content}</MarkdownBody>
                ) : (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                )}
                <div className="mt-1.5 flex items-center gap-2">
                  {msg.role === "assistant" ? (
                    <button
                      type="button"
                      className={`text-xs ${saveState === "saved" ? "text-success" : "text-accent"} ${
                        saveState ? "" : "hover:underline"
                      }`}
                      onClick={() => void saveToComments(msg.id, msg.content)}
                      disabled={saveState === "saving" || saveState === "saved"}
                    >
                      {saveState === "saved" ? t("savedToComments") : t("saveToComments")}
                    </button>
                  ) : null}
                  <CopyTextButton
                    text={msg.content}
                    className={
                      msg.role === "user"
                        ? "text-xs text-white/85 hover:underline"
                        : "text-xs text-muted hover:underline"
                    }
                  />
                  {saveState === "failed" ? (
                    <span role="alert" className="text-xs text-danger">{t("saveToCommentsFailed")}</span>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}

        {streaming ? (
          // polite live region: screen readers announce the reply as it lands
          // instead of staying silent through the whole stream.
          <div aria-live="polite">
            <div className="max-w-[85%] rounded-lg bg-surface px-3 py-2 text-sm">
              {/* Plain text while the tokens land: markdown of a half-written fence
                  reflows on every chunk. The finished message renders as markdown. */}
              <div className="whitespace-pre-wrap">{streaming}<span className="animate-pulse">▊</span></div>
            </div>
          </div>
        ) : null}

      </div>

      <div className="border-t border-border p-3">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            className="flex-1 resize-none rounded border border-control px-3 py-2 text-sm"
            rows={2}
            placeholder={t("inputPlaceholder")} aria-label={t("inputPlaceholder")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          <button
            className="self-end rounded bg-accent transition-transform duration-150 active:scale-[0.98] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={handleSubmit}
            disabled={loading || !input.trim()}
          >
            {t("send")}
          </button>
        </div>
      </div>
    </section>
  );
}
