"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

type ConfigSource = "db" | "env" | "none";

type ConfigView = {
  source: ConfigSource;
  baseUrl: string;
  model: string;
  apiKeyMasked: string;
};

type TestResult =
  | { ok: true; total: number; models: string[]; modelFound: boolean }
  | { ok: false; status: number; message: string };

const SOURCE_LABEL_KEYS: Record<ConfigSource, string> = {
  db: "sourceDb",
  env: "sourceEnv",
  none: "sourceNone"
};

export function LlmSettingsForm() {
  const t = useTranslations("settingsLlm");
  const [config, setConfig] = useState<ConfigView | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loadError, setLoadError] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");

  function applyConfig(next: ConfigView) {
    setConfig(next);
    setBaseUrl(next.baseUrl);
    setModel(next.model);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/settings/llm");
        if (!res.ok) {
          if (!cancelled) setLoadError(t("loadFailed"));
          return;
        }
        const data = (await res.json()) as ConfigView;
        if (!cancelled) applyConfig(data);
      } catch {
        if (!cancelled) setLoadError(t("loadFailed"));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function handleTest() {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    setSaveMessage("");
    setSaveError("");

    const payload: { baseUrl: string; model: string; apiKey?: string } = {
      baseUrl: baseUrl.trim(),
      model: model.trim()
    };
    if (apiKey.trim()) payload.apiKey = apiKey.trim();

    try {
      const res = await fetch("/api/settings/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = (await res.json().catch(() => null)) as (TestResult & { error?: string }) | null;
      if (!res.ok) {
        // 400 走 { error } 形状（如 https 校验），把服务端的原因透出来
        setTestResult({ ok: false, status: res.status, message: data?.error ?? t("testFailed") });
        return;
      }
      if (data) setTestResult(data);
    } catch {
      setTestResult({ ok: false, status: 0, message: t("testFailed") });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setSaveMessage("");
    setSaveError("");
    setTestResult(null);

    const payload: { baseUrl: string; model: string; apiKey?: string } = {
      baseUrl: baseUrl.trim(),
      model: model.trim()
    };
    if (apiKey.trim()) payload.apiKey = apiKey.trim();

    try {
      const res = await fetch("/api/settings/llm", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = (await res.json().catch(() => null)) as (ConfigView & { error?: string }) | null;
      if (!res.ok) {
        setSaveError(data?.error ?? t("saveFailed"));
        return;
      }
      if (data) applyConfig(data);
      setApiKey("");
      setSaveMessage(t("saved"));
    } catch {
      setSaveError(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return <p className="mt-6 text-sm text-red-600">{loadError}</p>;
  }

  if (!config) {
    return <p className="mt-6 text-sm text-muted">{t("loading")}</p>;
  }

  const busy = testing || saving;
  const apiKeyPlaceholder = config.apiKeyMasked
    ? t("apiKeyPlaceholderMasked", { masked: config.apiKeyMasked })
    : t("apiKeyPlaceholder");

  return (
    <div className="mt-6 grid gap-5">
      <div className="text-sm">
        <span className="mr-1 text-muted">{t("sourceLabel")}</span>
        <span className="rounded bg-surface px-2 py-1 font-medium" data-testid="llm-source">
          {t(SOURCE_LABEL_KEYS[config.source])}
        </span>
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="baseUrl">{t("baseUrlLabel")}</label>
        <p className="text-xs text-muted">{t("baseUrlHint")}</p>
        <input
          className="mt-1 w-full rounded border border-border px-3 py-2"
          id="baseUrl"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://api.deepseek.com"
        />
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="model">{t("modelLabel")}</label>
        <p className="text-xs text-muted">{t("modelHint")}</p>
        <input
          className="mt-1 w-full rounded border border-border px-3 py-2"
          id="model"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="deepseek-chat"
        />
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="apiKey">{t("apiKeyLabel")}</label>
        <p className="text-xs text-muted">{t("apiKeyHint")}</p>
        <input
          className="mt-1 w-full rounded border border-border px-3 py-2"
          id="apiKey"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={apiKeyPlaceholder}
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
      </div>

      {testResult ? (
        testResult.ok ? (
          <p className="text-sm text-green-700" data-testid="llm-test-result">
            {testResult.modelFound
              ? t("testSuccessWithModel", { count: testResult.total })
              : t("testSuccessWithoutModel", { count: testResult.total, model: model.trim() })}
          </p>
        ) : (
          <p className="text-sm text-red-600" data-testid="llm-test-result">
            ✗ {testResult.status || t("connectionError")} {testResult.message}
          </p>
        )
      ) : null}

      {saveMessage ? (
        <p className="text-sm text-green-700" data-testid="llm-save-result">{saveMessage}</p>
      ) : null}
      {saveError ? (
        <p className="text-sm text-red-600" data-testid="llm-save-result">{saveError}</p>
      ) : null}
    </div>
  );
}
