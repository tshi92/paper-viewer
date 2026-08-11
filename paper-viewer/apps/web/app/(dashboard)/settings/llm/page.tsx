import { canManageLabels } from "@paper-viewer/core/permissions";
import { requireCurrentUser } from "@/lib/auth";
import { LlmSettingsForm } from "@/components/llm-settings-form";

export default async function LlmSettingsPage() {
  const user = await requireCurrentUser();

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">LLM 配置</h1>
      <p className="mt-1 text-sm text-muted">配置工作区使用的大模型服务地址、模型名与 API Key。</p>

      {canManageLabels(user.role) ? (
        <LlmSettingsForm />
      ) : (
        <p className="mt-6 rounded border border-border bg-surface px-4 py-3 text-sm text-muted">
          LLM 配置仅管理员可见。如需修改，请联系工作区管理员。
        </p>
      )}
    </div>
  );
}
