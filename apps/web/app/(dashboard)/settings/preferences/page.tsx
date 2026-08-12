import { getTranslations } from "next-intl/server";
import { canManageWorkspaceSettings } from "@paper-viewer/core/permissions";
import { prisma } from "@paper-viewer/db";
import { requireCurrentUser } from "@/lib/auth";

function ReadOnlyList({
  label,
  values,
  emptyLabel
}: {
  label: string;
  values: string[];
  emptyLabel: string;
}) {
  return (
    <div>
      <div className="text-sm font-medium">{label}</div>
      {values.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{emptyLabel}</p>
      ) : (
        <div className="mt-1 flex flex-wrap gap-2">
          {values.map((value) => (
            <span className="rounded bg-surface px-2 py-1 text-sm" key={value}>
              {value}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default async function PreferencesPage() {
  const user = await requireCurrentUser();
  const t = await getTranslations("settingsPreferences");
  const canEdit = canManageWorkspaceSettings(user.role);

  const prefs = await prisma.researchPreferences.findUnique({
    where: { workspaceId: user.workspaceId }
  });

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("description")}</p>

      {canEdit ? (
        <form className="mt-6 grid gap-5" action="/api/settings/preferences" method="post">
          <div>
            <label className="text-sm font-medium" htmlFor="topics">{t("topicsLabel")}</label>
            <p className="text-xs text-muted">{t("topicsHint")}</p>
            <textarea
              className="mt-1 w-full rounded border border-control px-3 py-2"
              id="topics"
              name="topics"
              rows={4}
              placeholder={t("topicsPlaceholder")}
              defaultValue={prefs?.topics.join("\n") ?? ""}
            />
          </div>

          <div>
            <label className="text-sm font-medium" htmlFor="keywords">{t("keywordsLabel")}</label>
            <p className="text-xs text-muted">{t("keywordsHint")}</p>
            <input
              className="mt-1 w-full rounded border border-control px-3 py-2"
              id="keywords"
              name="keywords"
              placeholder={t("keywordsPlaceholder")}
              defaultValue={prefs?.keywords.join(", ") ?? ""}
            />
          </div>

          <div>
            <label className="text-sm font-medium" htmlFor="arxivCategories">{t("categoriesLabel")}</label>
            <p className="text-xs text-muted">{t("categoriesHint")}</p>
            <input
              className="mt-1 w-full rounded border border-control px-3 py-2"
              id="arxivCategories"
              name="arxivCategories"
              placeholder={t("categoriesPlaceholder")}
              defaultValue={prefs?.arxivCategories.join(", ") ?? ""}
            />
          </div>

          <div>
            <label className="text-sm font-medium" htmlFor="excludedTopics">{t("excludedLabel")}</label>
            <p className="text-xs text-muted">{t("excludedHint")}</p>
            <textarea
              className="mt-1 w-full rounded border border-control px-3 py-2"
              id="excludedTopics"
              name="excludedTopics"
              rows={2}
              placeholder={t("excludedPlaceholder")}
              defaultValue={prefs?.excludedTopics.join("\n") ?? ""}
            />
          </div>

          <div>
            <label className="text-sm font-medium" htmlFor="papersPerDay">{t("papersPerDayLabel")}</label>
            <input
              className="mt-1 w-32 rounded border border-control px-3 py-2"
              id="papersPerDay"
              name="papersPerDay"
              type="number"
              min={1}
              max={20}
              defaultValue={prefs?.papersPerDay ?? 10}
            />
          </div>

          <button className="rounded bg-accent px-4 py-2 font-medium text-white" type="submit">
            {t("save")}
          </button>
        </form>
      ) : (
        <div className="mt-6 grid gap-5">
          <p className="rounded border border-border bg-surface px-4 py-3 text-sm text-muted">
            {t("adminOnly")}
          </p>
          <ReadOnlyList label={t("topicsLabel")} values={prefs?.topics ?? []} emptyLabel={t("notSet")} />
          <ReadOnlyList label={t("keywordsLabel")} values={prefs?.keywords ?? []} emptyLabel={t("notSet")} />
          <ReadOnlyList label={t("categoriesLabel")} values={prefs?.arxivCategories ?? []} emptyLabel={t("notSet")} />
          <ReadOnlyList label={t("excludedLabel")} values={prefs?.excludedTopics ?? []} emptyLabel={t("notSet")} />
          <div>
            <div className="text-sm font-medium">{t("papersPerDayLabel")}</div>
            <p className="mt-1 text-sm text-muted">{prefs?.papersPerDay ?? 10}</p>
          </div>
        </div>
      )}
    </div>
  );
}
