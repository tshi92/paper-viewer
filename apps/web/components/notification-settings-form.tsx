"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "./confirm-dialog";

type NotificationView = {
  configured: boolean;
  feishuWebhookMasked: string;
  pushHour: number;
};

type TestResult = { ok: boolean; message?: string };

type UpdatePayload = { feishuWebhookUrl?: string; pushHour?: number };

/** Whole hours 0-23, displayed as "00:00" … "23:00". */
const PUSH_HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function NotificationSettingsForm() {
  const t = useTranslations("settingsNotifications");
  const [config, setConfig] = useState<NotificationView | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [pushHour, setPushHour] = useState(9);
  const [loadError, setLoadError] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  // Both the test send (it pings the real Feishu group) and the clear (it stops
  // the daily push) deserve a pause before firing.
  const [pendingAction, setPendingAction] = useState<"test" | "clear" | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/settings/notifications");
        if (!res.ok) {
          if (!cancelled) setLoadError(t("loadFailed"));
          return;
        }
        const data = (await res.json()) as NotificationView;
        if (!cancelled) {
          setConfig(data);
          setPushHour(data.pushHour);
        }
      } catch {
        if (!cancelled) setLoadError(t("loadFailed"));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [t]);

  function resetMessages() {
    setTestResult(null);
    setSaveMessage("");
    setSaveError("");
  }

  async function handleTest() {
    if (testing || saving) return;
    setTesting(true);
    resetMessages();

    const payload: { feishuWebhookUrl?: string } = {};
    if (webhookUrl.trim()) payload.feishuWebhookUrl = webhookUrl.trim();

    try {
      const res = await fetch("/api/settings/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        setTestResult({ ok: false });
        return;
      }
      setTestResult((await res.json()) as TestResult);
    } catch {
      setTestResult({ ok: false });
    } finally {
      setTesting(false);
    }
  }

  /** For both fields, absent = leave unchanged; `feishuWebhookUrl` additionally has empty string = clear, see the comment in the API route. */
  async function submit(body: UpdatePayload, successMessage: string) {
    if (testing || saving) return;
    setSaving(true);
    resetMessages();

    try {
      const res = await fetch("/api/settings/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = (await res.json().catch(() => null)) as
        | (NotificationView & { error?: string })
        | null;
      if (!res.ok) {
        setSaveError(data?.error ?? t("saveFailed"));
        return;
      }
      if (data) {
        setConfig({
          configured: data.configured,
          feishuWebhookMasked: data.feishuWebhookMasked,
          pushHour: data.pushHour
        });
        setPushHour(data.pushHour);
      }
      setWebhookUrl("");
      setSaveMessage(successMessage);
    } catch {
      setSaveError(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  /** Saves two things at once: the push hour is always submitted, while leaving the webhook blank leaves it unchanged. */
  async function handleSave() {
    const trimmed = webhookUrl.trim();
    await submit({ pushHour, ...(trimmed ? { feishuWebhookUrl: trimmed } : {}) }, t("saved"));
  }

  async function handleClear() {
    await submit({ feishuWebhookUrl: "" }, t("cleared"));
  }

  if (loadError) {
    return <p role="alert" className="mt-6 text-sm text-danger">{loadError}</p>;
  }

  if (!config) {
    return <p className="mt-6 text-sm text-muted">{t("loading")}</p>;
  }

  const busy = testing || saving;
  const placeholder = config.configured
    ? t("webhookPlaceholderMasked", { masked: config.feishuWebhookMasked })
    : t("webhookPlaceholder");

  return (
    <div className="mt-6 grid gap-5">
      <div className="text-sm" data-testid="notification-status">
        <span className="mr-1 text-muted">{t("statusLabel")}</span>
        <span className="rounded bg-surface px-2 py-1 font-medium">
          {config.configured
            ? t("statusConfigured", { masked: config.feishuWebhookMasked })
            : t("statusNotConfigured")}
        </span>
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="feishuWebhookUrl">{t("webhookLabel")}</label>
        <p className="text-xs text-muted">{t("webhookHint")}</p>
        <input
          className="mt-1 w-full rounded border border-control px-3 py-2"
          id="feishuWebhookUrl"
          value={webhookUrl}
          onChange={(event) => setWebhookUrl(event.target.value)}
          placeholder={placeholder}
        />
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="pushHour">{t("pushHourLabel")}</label>
        <p className="text-xs text-muted">{t("pushHourHint")}</p>
        <select
          className="mt-1 rounded border border-control px-3 py-2"
          id="pushHour"
          data-testid="push-hour-select"
          value={pushHour}
          onChange={(event) => setPushHour(Number(event.target.value))}
        >
          {PUSH_HOURS.map((hour) => (
            <option key={hour} value={hour}>
              {formatHour(hour)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3">
        <button
          className="rounded border border-border px-4 py-2 font-medium disabled:opacity-50"
          type="button"
          onClick={() => setPendingAction("test")}
          disabled={busy}
        >
          {testing ? t("testing") : t("test")}
        </button>
        <button
          className="rounded bg-accent transition-transform duration-150 active:scale-[0.98] px-4 py-2 font-medium text-white disabled:opacity-50"
          type="button"
          onClick={handleSave}
          disabled={busy}
        >
          {saving ? t("saving") : t("save")}
        </button>
        <button
          className="rounded border border-border px-4 py-2 font-medium text-danger disabled:opacity-50"
          type="button"
          onClick={() => setPendingAction("clear")}
          disabled={busy || !config.configured}
        >
          {t("clear")}
        </button>
      </div>

      <ConfirmDialog
        open={pendingAction !== null}
        message={pendingAction === "clear" ? t("clearConfirm") : t("testConfirm")}
        confirmLabel={pendingAction === "clear" ? t("clear") : t("test")}
        destructive={pendingAction === "clear"}
        onConfirm={() => {
          const action = pendingAction;
          setPendingAction(null);
          if (action === "test") void handleTest();
          if (action === "clear") void handleClear();
        }}
        onCancel={() => setPendingAction(null)}
      />

      {testResult ? (
        testResult.ok ? (
          <p role="status" className="text-sm text-success" data-testid="notification-test-result">
            {t("testSuccess")}
          </p>
        ) : (
          <p role="alert" className="text-sm text-danger" data-testid="notification-test-result">
            {/* The server only includes a message when there is no usable address; every other failure reason gets the same generic notice. */}
            ✗ {testResult.message ? t("testNotConfigured") : t("testFailed")}
          </p>
        )
      ) : null}

      {saveMessage ? (
        <p role="status" className="text-sm text-success" data-testid="notification-save-result">{saveMessage}</p>
      ) : null}
      {saveError ? (
        <p role="alert" className="text-sm text-danger" data-testid="notification-save-result">{saveError}</p>
      ) : null}
    </div>
  );
}
