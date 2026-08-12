"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { LabelListItem } from "@/lib/annotation-types";
import { ConfirmDialog } from "./confirm-dialog";

type LabelScope = LabelListItem["scope"];

const SCOPE_SECTIONS: { scope: LabelScope; headingKey: string; hintKey: string }[] = [
  { scope: "annotation", headingKey: "annotationHeading", hintKey: "annotationHint" },
  { scope: "paper", headingKey: "paperHeading", hintKey: "paperHint" }
];

const DEFAULT_COLOR = "#2563eb";

export function LabelSettings() {
  const t = useTranslations("settingsLabels");
  const [labels, setLabels] = useState<LabelListItem[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");

  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/workspace/labels");
      if (!response.ok) {
        setLoadError(t("loadFailed"));
        return;
      }
      const data = (await response.json()) as { labels: LabelListItem[] };
      setLoadError("");
      setLabels(data.labels);
    } catch {
      setLoadError(t("loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Runs a mutation, surfaces the server's reason on failure, and refreshes the list. */
  const mutate = useCallback(
    async (url: string, init: RequestInit): Promise<boolean> => {
      setActionError("");
      try {
        const response = await fetch(url, init);
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          setActionError(data?.error ?? t("actionFailed"));
          return false;
        }
        await reload();
        return true;
      } catch {
        setActionError(t("actionFailed"));
        return false;
      }
    },
    [reload, t]
  );

  const createLabel = useCallback(
    (scope: LabelScope, name: string, color: string) =>
      mutate("/api/workspace/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color, scope })
      }),
    [mutate]
  );

  const updateLabel = useCallback(
    (labelId: string, name: string, color: string) =>
      mutate(`/api/workspace/labels/${labelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color })
      }),
    [mutate]
  );

  const deleteLabel = useCallback(
    (labelId: string) => mutate(`/api/workspace/labels/${labelId}`, { method: "DELETE" }),
    [mutate]
  );

  if (loadError) {
    return <p className="mt-6 text-sm text-red-600">{loadError}</p>;
  }

  if (!labels) {
    return <p className="mt-6 text-sm text-muted">{t("loading")}</p>;
  }

  return (
    <div className="mt-6 grid gap-8">
      {actionError ? (
        <p className="text-sm text-red-600" data-testid="label-error">
          {actionError}
        </p>
      ) : null}
      {SCOPE_SECTIONS.map((section) => (
        <section key={section.scope} data-testid={`label-section-${section.scope}`}>
          <h2 className="text-sm font-medium">{t(section.headingKey)}</h2>
          <p className="text-xs text-muted">{t(section.hintKey)}</p>
          <div className="mt-2 divide-y divide-border rounded border border-border">
            {labels
              .filter((label) => label.scope === section.scope)
              .map((label) => (
                <LabelRow key={label.id} label={label} onSave={updateLabel} onDelete={deleteLabel} />
              ))}
            {labels.every((label) => label.scope !== section.scope) ? (
              <p className="px-3 py-3 text-sm text-muted">{t("empty")}</p>
            ) : null}
            <AddLabelRow scope={section.scope} onCreate={createLabel} />
          </div>
        </section>
      ))}
    </div>
  );
}

function LabelRow({
  label,
  onSave,
  onDelete
}: {
  label: LabelListItem;
  onSave: (labelId: string, name: string, color: string) => Promise<boolean>;
  onDelete: (labelId: string) => Promise<boolean>;
}) {
  const t = useTranslations("settingsLabels");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(label.color);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function startEditing() {
    setName(label.name);
    setColor(label.color);
    setEditing(true);
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const saved = await onSave(label.id, trimmed, color);
    setBusy(false);
    if (saved) setEditing(false);
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    await onDelete(label.id);
    setBusy(false);
    setConfirmingDelete(false);
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2" data-testid="label-row">
      {editing ? (
        <>
          <input
            aria-label={t("colorLabel")}
            className="h-7 w-9 shrink-0 rounded border border-border"
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
          <input
            aria-label={t("namePlaceholder")}
            className="min-w-0 flex-1 rounded border border-border px-2 py-1 text-sm"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void save();
              }
            }}
          />
          <button
            className="text-xs font-medium text-accent disabled:opacity-50"
            type="button"
            disabled={busy || !name.trim()}
            onClick={() => void save()}
          >
            {busy ? t("saving") : t("save")}
          </button>
          <button
            className="text-xs text-muted"
            type="button"
            onClick={() => setEditing(false)}
          >
            {t("cancel")}
          </button>
        </>
      ) : (
        <>
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ background: label.color }}
          />
          <span className="min-w-0 flex-1 truncate text-sm" data-testid="label-name">
            {label.name}
          </span>
          <span className="text-xs text-muted" data-testid="label-usage">
            {t("usage", { count: label.usageCount })}
          </span>
          <button
            className="text-xs text-accent"
            type="button"
            data-testid="label-edit"
            onClick={startEditing}
          >
            {t("edit")}
          </button>
          <button
            className="text-xs text-red-500 disabled:opacity-50"
            type="button"
            data-testid="label-delete"
            disabled={busy}
            onClick={() => setConfirmingDelete(true)}
          >
            {busy ? t("deleting") : t("delete")}
          </button>
          <ConfirmDialog
            open={confirmingDelete}
            message={
              label.usageCount > 0
                ? t("deleteConfirm", { name: label.name, count: label.usageCount })
                : t("deleteConfirmUnused", { name: label.name })
            }
            confirmLabel={t("delete")}
            busy={busy}
            onConfirm={() => void remove()}
            onCancel={() => {
              if (!busy) setConfirmingDelete(false);
            }}
          />
        </>
      )}
    </div>
  );
}

function AddLabelRow({
  scope,
  onCreate
}: {
  scope: LabelScope;
  onCreate: (scope: LabelScope, name: string, color: string) => Promise<boolean>;
}) {
  const t = useTranslations("settingsLabels");
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const created = await onCreate(scope, trimmed, color);
    setBusy(false);
    if (created) {
      setName("");
      setColor(DEFAULT_COLOR);
    }
  }

  return (
    <form
      className="flex items-center gap-2 bg-surface px-3 py-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <input
        aria-label={t("colorLabel")}
        className="h-7 w-9 shrink-0 rounded border border-border"
        data-testid={`label-add-color-${scope}`}
        type="color"
        value={color}
        onChange={(event) => setColor(event.target.value)}
      />
      <input
        aria-label={t("namePlaceholder")}
        className="min-w-0 flex-1 rounded border border-border px-2 py-1 text-sm"
        data-testid={`label-add-name-${scope}`}
        maxLength={50}
        placeholder={t("namePlaceholder")}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <button
        className="rounded bg-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        data-testid={`label-add-submit-${scope}`}
        type="submit"
        disabled={busy || !name.trim()}
      >
        {busy ? t("adding") : t("add")}
      </button>
    </form>
  );
}
