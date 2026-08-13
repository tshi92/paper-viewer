import Link from "next/link";
import { getTranslations } from "next-intl/server";

/**
 * The slot a saved paper occupies where unsaved ones show "save to library".
 * It used to be a dead badge that only stated a fact; it now takes you to the
 * paper, opened under the Library tab — that is where a saved paper belongs,
 * so `from=library` keeps the nav highlight honest.
 */
export async function InLibraryLink({
  paperId,
  className = ""
}: {
  paperId: string;
  /** Layout-only additions from the caller (e.g. `shrink-0` inside a flex row). */
  className?: string;
}) {
  const t = await getTranslations("home");
  return (
    <Link
      href={`/papers/${paperId}?from=library`}
      className={`whitespace-nowrap rounded bg-surface px-2 py-0.5 text-xs text-muted transition-colors duration-150 hover:bg-border hover:text-ink ${className}`}
    >
      {t("showInLibrary")}
    </Link>
  );
}
