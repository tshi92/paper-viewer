import { getTranslations } from "next-intl/server";

/**
 * Marks a settings page as one only administrators can change.
 *
 * Shown to everyone, not just to members who lack the permission: an admin
 * needs to know that what they are about to edit is workspace-wide and that
 * their teammates cannot do it themselves, and a member needs to know why the
 * page is read-only before they go looking for a save button. The four pages
 * that carry it — research preferences, LLM, notifications and members — are
 * exactly the ones gated on `canManageWorkspaceSettings`.
 */
export async function AdminOnlyNote() {
  const t = await getTranslations("common");

  return (
    <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-surface px-2 py-1 text-xs text-muted">
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" aria-hidden="true">
        <path
          d="M4.5 7V5a3.5 3.5 0 1 1 7 0v2"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <rect
          x="3"
          y="7"
          width="10"
          height="6.5"
          rx="1.5"
          stroke="currentColor"
          strokeWidth="1.3"
        />
      </svg>
      {t("adminOnly")}
    </p>
  );
}
