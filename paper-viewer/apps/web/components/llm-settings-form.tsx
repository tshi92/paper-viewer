"use client";

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

const SOURCE_LABEL: Record<ConfigSource, string> = {
  db: "数据库配置",
  env: "环境变量兜底",
  none: "未配置"
};

function keyPlaceholder(masked: string): string {
  return masked ? `${masked}（留空保持不变）` : "留空保持不变";
}

export function LlmSettingsForm() {
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
          if (!cancelled) setLoadError("加载配置失败");
          return;
        }
        const data = (await res.json()) as ConfigView;
        if (!cancelled) applyConfig(data);
      } catch {
        if (!cancelled) setLoadError("加载配置失败");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

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
      if (!res.ok) {
        setTestResult({ ok: false, status: res.status, message: "测试请求失败" });
        return;
      }
      setTestResult((await res.json()) as TestResult);
    } catch {
      setTestResult({ ok: false, status: 0, message: "测试请求失败" });
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
        setSaveError(data?.error ?? "保存失败");
        return;
      }
      if (data) applyConfig(data);
      setApiKey("");
      setSaveMessage("已保存");
    } catch {
      setSaveError("保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return <p className="mt-6 text-sm text-red-600">{loadError}</p>;
  }

  if (!config) {
    return <p className="mt-6 text-sm text-muted">加载中…</p>;
  }

  const busy = testing || saving;

  return (
    <div className="mt-6 grid gap-5">
      <div className="text-sm">
        <span className="text-muted">当前生效：</span>
        <span className="rounded bg-surface px-2 py-1 font-medium" data-testid="llm-source">
          {SOURCE_LABEL[config.source]}
        </span>
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="baseUrl">Base URL</label>
        <p className="text-xs text-muted">OpenAI 兼容接口地址，例如 https://api.deepseek.com</p>
        <input
          className="mt-1 w-full rounded border border-border px-3 py-2"
          id="baseUrl"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://api.deepseek.com"
        />
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="model">模型名</label>
        <p className="text-xs text-muted">用于摘要与对话的模型标识。</p>
        <input
          className="mt-1 w-full rounded border border-border px-3 py-2"
          id="model"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="deepseek-chat"
        />
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="apiKey">API Key</label>
        <p className="text-xs text-muted">出于安全考虑，已保存的 Key 只显示掩码。</p>
        <input
          className="mt-1 w-full rounded border border-border px-3 py-2"
          id="apiKey"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={keyPlaceholder(config.apiKeyMasked)}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          className="rounded border border-border px-4 py-2 font-medium disabled:opacity-50"
          type="button"
          onClick={handleTest}
          disabled={busy}
        >
          {testing ? "测试中…" : "测试连接"}
        </button>
        <button
          className="rounded bg-accent px-4 py-2 font-medium text-white disabled:opacity-50"
          type="button"
          onClick={handleSave}
          disabled={busy}
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>

      {testResult ? (
        testResult.ok ? (
          <p className="text-sm text-green-700" data-testid="llm-test-result">
            ✓ 连接成功，共 {testResult.total} 个模型
            {testResult.modelFound ? "，含当前模型" : `，但未找到当前模型「${model.trim()}」`}
          </p>
        ) : (
          <p className="text-sm text-red-600" data-testid="llm-test-result">
            ✗ {testResult.status || "连接错误"} {testResult.message}
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
