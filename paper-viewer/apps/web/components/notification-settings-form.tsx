"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

type NotificationView = {
  configured: boolean;
  feishuWebhookMasked: string;
};

type TestResult = { ok: boolean; message?: string };

export function NotificationSettingsForm() {
  const t = useTranslations("settingsNotifications");
  const [config, setConfig] = useState<NotificationView | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [loadError, setLoadError] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");

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
        if (!cancelled) setConfig(data);
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

  /** `feishuWebhookUrl` 缺省=保持不变，空串=清除，见 API 路由注释。 */
  async function submit(body: { feishuWebhookUrl?: string }, successMessage: string) {
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
      if (data) setConfig({ configured: data.configured, feishuWebhookMasked: data.feishuWebhookMasked });
      setWebhookUrl("");
      setSaveMessage(successMessage);
    } catch {
      setSaveError(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    const trimmed = webhookUrl.trim();
    if (!trimmed) {
      setSaveError(t("webhookRequired"));
      return;
    }
    await submit({ feishuWebhookUrl: trimmed }, t("saved"));
  }

  async function handleClear() {
    if (!window.confirm(t("clearConfirm"))) return;
    await submit({ feishuWebhookUrl: "" }, t("cleared"));
  }

  if (loadError) {
    return <p className="mt-6 text-sm text-red-600">{loadError}</p>;
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
          className="mt-1 w-full rounded border border-border px-3 py-2"
          id="feishuWebhookUrl"
          value={webhookUrl}
          onChange={(event) => setWebhookUrl(event.target.value)}
          placeholder={placeholder}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          className="rounded border border-border px-4 py-2 font-medium disabled:opacity-50"
          type="button"
          onClick={handleTest}
          disabled={busy}
        >
          {testing ? t("testing") : t("test")}
        </button>
        <button
          className="rounded bg-accent px-4 py-2 font-medium text-white disabled:opacity-50"
          type="button"
          onClick={handleSave}
          disabled={busy}
        >
          {saving ? t("saving") : t("save")}
        </button>
        <button
          className="rounded border border-border px-4 py-2 font-medium text-red-600 disabled:opacity-50"
          type="button"
          onClick={handleClear}
          disabled={busy || !config.configured}
        >
          {t("clear")}
        </button>
      </div>

      {testResult ? (
        testResult.ok ? (
          <p className="text-sm text-green-700" data-testid="notification-test-result">
            {t("testSuccess")}
          </p>
        ) : (
          <p className="text-sm text-red-600" data-testid="notification-test-result">
            {/* 服务端只在「没有可用地址」时带 message，其余失败原因统一提示。 */}
            ✗ {testResult.message ? t("testNotConfigured") : t("testFailed")}
          </p>
        )
      ) : null}

      {saveMessage ? (
        <p className="text-sm text-green-700" data-testid="notification-save-result">{saveMessage}</p>
      ) : null}
      {saveError ? (
        <p className="text-sm text-red-600" data-testid="notification-save-result">{saveError}</p>
      ) : null}
    </div>
  );
}
