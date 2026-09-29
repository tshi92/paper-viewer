import { Fragment } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { splitHighlights, type DigestContent } from "@/lib/researcher-digest";
import { DIRECTIONS } from "@/lib/researchers";

const TINT = new Map(DIRECTIONS.map((d) => [d.id, d.tint]));

/** [[directionId|text]] → the text on its direction's tint. Plain text on purpose: not a link, not a filter. */
function Highlighted({ text }: { text: string }) {
  return (
    <>
      {splitHighlights(text).map((part, i) =>
        part.directionId ? (
          <span
            key={i}
            className="rounded-[4px] px-1 [-webkit-box-decoration-break:clone] [box-decoration-break:clone]"
            style={{ background: TINT.get(part.directionId) }}
          >
            {part.text}
          </span>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        )
      )}
    </>
  );
}

/**
 * The workspace's latest sealed issue. It always carries its own month and
 * its own window and figures (stored with it), so an older issue shown as the
 * fallback never reads as this month's, and its numbers never disagree with
 * its text after a later sync.
 */
export async function HotTopicsCard({
  issue,
  isCurrent
}: {
  issue: { month: Date; content: DigestContent } | null;
  isCurrent: boolean;
}) {
  const t = await getTranslations("researchers");
  const locale = await getLocale();
  if (!issue) {
    return <section className="rounded bg-white px-5 py-4 text-sm text-muted shadow-card">{t("digestEmpty")}</section>;
  }
  const { month, content } = issue;
  // Same {year}/{month} placeholders in both catalogs (messages.test.ts): zh
  // reads "2026 年 9 月刊", en "September 2026 issue".
  const monthParam = locale.startsWith("zh")
    ? String(month.getUTCMonth() + 1)
    : month.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const md = (iso: string) => iso.slice(5);

  return (
    <section aria-labelledby="hot-topics-title" className="rounded bg-white shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pt-4">
        <h2 id="hot-topics-title" className="text-base font-semibold">
          {t("digestTitle", { year: month.getUTCFullYear(), month: monthParam })}
          {isCurrent ? null : <span className="ml-2 text-xs font-normal text-muted">{t("digestPrevious")}</span>}
        </h2>
        <span className="text-[12.5px] tabular-nums text-muted">
          {t("digestAside", {
            from: md(content.window.from),
            to: md(content.window.to),
            researchers: content.stats.researchers,
            papers: content.stats.papers
          })}
        </span>
      </div>
      <div className="grid gap-2.5 px-5 pb-5 pt-2">
        <p className="text-[21px] font-bold leading-[1.45]">
          {t("headlinePrefix")}
          <Highlighted text={content.headline} />
        </p>
        <p className="text-[15.5px] leading-[1.9]">
          <Highlighted text={content.lede} />
        </p>
        <div className="mt-1.5 text-xs font-semibold tracking-[.08em] text-muted">{t("observations")}</div>
        <ol className="grid list-decimal gap-2.5 pl-[1.4em] text-[15px] leading-[1.85]">
          {content.observations.map((o, i) => (
            <li key={i}>
              <b className="mr-1 font-semibold"><Highlighted text={o.claim} /></b>
              <Highlighted text={o.evidence} />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
