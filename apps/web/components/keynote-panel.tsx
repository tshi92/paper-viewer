"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

type Keynote = {
  id: string;
  content: string;
  source: string;
  createdAt: string;
  author: { email: string; name: string | null };
};

export function KeynotePanel({ paperId }: { paperId: string }) {
  const t = useTranslations("keynotes");
  const locale = useLocale();
  const [keynotes, setKeynotes] = useState<Keynote[]>([]);
  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch(`/api/papers/${paperId}/keynotes`)
      .then((r) => r.json())
      .then((data: { keynotes: Keynote[] }) => setKeynotes(data.keynotes))
      .catch(() => {});
  }, [paperId]);

  const handleAdd = useCallback(async () => {
    const text = input.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/papers/${paperId}/keynotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, source: "manual" })
      });
      if (res.ok) {
        const data = await res.json() as { keynote: Keynote };
        setKeynotes((prev) => [...prev, data.keynote]);
        setInput("");
      }
    } finally {
      setSaving(false);
      inputRef.current?.focus();
    }
  }, [input, saving, paperId]);

  const handleUpdate = useCallback(async (id: string) => {
    const text = editContent.trim();
    if (!text) return;
    const res = await fetch(`/api/papers/${paperId}/keynotes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text })
    });
    if (res.ok) {
      const data = await res.json() as { keynote: Keynote };
      setKeynotes((prev) => prev.map((k) => (k.id === id ? data.keynote : k)));
    }
    setEditingId(null);
  }, [editContent, paperId]);

  const handleDelete = useCallback(async (id: string) => {
    const res = await fetch(`/api/papers/${paperId}/keynotes/${id}`, { method: "DELETE" });
    if (res.ok) {
      setKeynotes((prev) => prev.filter((k) => k.id !== id));
    }
  }, [paperId]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAdd();
    }
  }

  // `manual` keynotes carry no provenance note, so they get no suffix at all.
  const sourceLabel: Record<string, string> = {
    chat: t("sourceChat"),
    comment: t("sourceComment")
  };

  return (
    <section className="flex flex-col rounded border border-border bg-white" style={{ height: "calc(100vh - 280px)" }}>
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-semibold">{t("heading")}</h2>
      </div>

      <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
        {keynotes.length === 0 ? (
          <div className="text-center text-sm text-muted py-8">
            <p>{t("empty")}</p>
            <p className="mt-1 text-xs text-muted/70">{t("emptyHint")}</p>
          </div>
        ) : null}

        {keynotes.map((k) => (
          <div key={k.id} className="group rounded border border-border p-3 text-sm">
            {editingId === k.id ? (
              <div>
                <textarea
                  className="w-full resize-none rounded border border-border px-2 py-1.5 text-sm"
                  rows={3}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleUpdate(k.id); }
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  autoFocus
                />
                <div className="mt-1.5 flex gap-1.5">
                  <button className="rounded bg-accent px-2 py-1 text-xs text-white" onClick={() => handleUpdate(k.id)}>{t("save")}</button>
                  <button className="rounded px-2 py-1 text-xs text-muted hover:bg-surface" onClick={() => setEditingId(null)}>{t("cancel")}</button>
                </div>
              </div>
            ) : (
              <>
                <div className="whitespace-pre-wrap">{k.content}</div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-muted">
                    {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(k.createdAt))}
                    {sourceLabel[k.source] ? ` · ${sourceLabel[k.source]}` : ""}
                  </span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className="rounded px-1.5 py-0.5 text-xs text-muted hover:bg-surface"
                      onClick={() => { setEditingId(k.id); setEditContent(k.content); }}
                    >
                      {t("edit")}
                    </button>
                    <button
                      className="rounded px-1.5 py-0.5 text-xs text-red-500 hover:bg-red-50"
                      onClick={() => handleDelete(k.id)}
                    >
                      {t("delete")}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-border p-3">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            className="flex-1 resize-none rounded border border-border px-3 py-2 text-sm"
            rows={2}
            placeholder={t("inputPlaceholder")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={saving}
          />
          <button
            className="self-end rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={handleAdd}
            disabled={saving || !input.trim()}
          >
            {t("add")}
          </button>
        </div>
      </div>
    </section>
  );
}
