"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export function PaperChat({ paperId }: { paperId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load chat history
  useEffect(() => {
    fetch(`/api/papers/${paperId}/chat`)
      .then((r) => r.json())
      .then((data: { messages: ChatMessage[] }) => setMessages(data.messages))
      .catch(() => {});
  }, [paperId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setLoading(true);
    setStreaming("");

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
        setStreaming("Error: Failed to get response");
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
      setStreaming("Error: Network error");
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, paperId]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <section className="flex flex-col rounded border border-border bg-white" style={{ height: "calc(100vh - 280px)" }}>
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-semibold">Chat with Paper</h2>
      </div>

      <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !streaming ? (
          <div className="text-center text-sm text-muted py-8">
            <p>Ask anything about this paper.</p>
            <div className="mt-3 space-y-1 text-xs">
              <p className="text-muted/70">Try:</p>
              <p>&ldquo;Summarize the main contribution&rdquo;</p>
              <p>&ldquo;Explain the method in simple terms&rdquo;</p>
              <p>&ldquo;What are the limitations?&rdquo;</p>
            </div>
          </div>
        ) : null}

        {messages.map((msg) => (
          <div key={msg.id} className={msg.role === "user" ? "flex justify-end" : ""}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-accent text-white"
                  : "bg-surface text-ink"
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}

        {streaming ? (
          <div>
            <div className="max-w-[85%] rounded-lg bg-surface px-3 py-2 text-sm">
              <div className="whitespace-pre-wrap">{streaming}<span className="animate-pulse">▊</span></div>
            </div>
          </div>
        ) : null}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-border p-3">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            className="flex-1 resize-none rounded border border-border px-3 py-2 text-sm"
            rows={2}
            placeholder="Ask about this paper... (Enter to send)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
          />
          <button
            className="self-end rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={handleSubmit}
            disabled={loading || !input.trim()}
          >
            Send
          </button>
        </div>
      </div>
    </section>
  );
}
