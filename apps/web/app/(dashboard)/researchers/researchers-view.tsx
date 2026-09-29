"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InLibraryLink } from "@/components/in-library-link";
import { SaveToLibraryButton } from "@/components/save-to-library-button";
import {
  DAY_MS, DIRECTIONS, OTHER_DIRECTION_ID, directionLabel, fromIsoDay, tally, type ResearchDirection
} from "@/lib/researchers";

export type ViewResearcher = { slug: string; name: string; affiliation: string; knownFor: string };
export type ViewPaper = {
  id: string;
  arxivId: string;
  title: string;
  abstract: string;
  authors: string[];
  /** YYYY-MM-DD */
  published: string;
  directionId: string;
  researchers: { slug: string; position: number }[];
  inLibrary: boolean;
};
type Person = ViewResearcher & { papers: ViewPaper[]; asLast: number; mix: [ResearchDirection, number][] };
type Row = { r: Person; hits: ViewPaper[] };
type DrawerState = { slug: string; focusPaperId: string | undefined; showAll: boolean };
const VIEWS = ["bars", "timeline", "list"] as const;
type View = (typeof VIEWS)[number];

const VIEW_KEY = "researchers-view";
const BY_ID = new Map(DIRECTIONS.map((d) => [d.id, d]));
const directionOf = (p: ViewPaper) => BY_ID.get(p.directionId) ?? BY_ID.get(OTHER_DIRECTION_ID)!;

/** Dates, direction names and author roles, worded the same way in every sub-view. */
function useWording() {
  const t = useTranslations("researchers");
  const locale = useLocale();
  return useMemo(() => {
    const day = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" });
    const monthYear = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", timeZone: "UTC" });
    const month = new Intl.DateTimeFormat(locale, { month: locale.startsWith("zh") ? "short" : "long", timeZone: "UTC" });
    return {
      t,
      label: (d: ResearchDirection) => directionLabel(d, locale),
      fmtDay: (iso: string) => day.format(fromIsoDay(iso)),
      fmtMonthYear: (iso: string) => monthYear.format(fromIsoDay(iso)),
      fmtMonth: (date: Date) => month.format(date),
      role: (position: number, count: number) =>
        position === count ? t("lastAuthor") : position === 1 ? t("firstAuthor") : t("nthOf", { n: position, total: count })
    };
  }, [t, locale]);
}

function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />;
}

function NewBadge() {
  const { t } = useWording();
  return (
    <span className="mr-1 inline-block rounded-[4px] bg-accent/[0.08] px-[5px] align-[1px] text-[10.5px] font-semibold leading-[17px] tracking-[.04em] text-accent">
      {t("newBadge")}
    </span>
  );
}

export function ResearchersView({
  researchers,
  papers,
  windowFrom,
  windowTo,
  newSince
}: {
  researchers: ViewResearcher[];
  /** Newest first. */
  papers: ViewPaper[];
  windowFrom: string;
  windowTo: string;
  newSince: string;
}) {
  const w = useWording();
  const { t } = w;
  const [topic, setTopic] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("bars");
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  // Read after mount: the server render cannot know the stored choice.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(VIEW_KEY);
      if (VIEWS.some((v) => v === stored)) setView(stored as View);
    } catch {
      /* storage blocked */
    }
  }, []);
  function chooseView(next: View) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* storage blocked */
    }
  }

  const people = useMemo<Person[]>(
    () =>
      researchers.map((r) => {
        const own = papers.filter((p) => p.researchers.some((x) => x.slug === r.slug));
        return {
          ...r,
          papers: own,
          asLast: own.filter((p) => p.researchers.some((x) => x.slug === r.slug && x.position === p.authors.length)).length,
          mix: DIRECTIONS.map((d) => [d, own.filter((p) => p.directionId === d.id).length] as [ResearchDirection, number]).filter(
            ([, n]) => n > 0
          )
        };
      }),
    [researchers, papers]
  );
  const names = useMemo(() => new Map(researchers.map((r) => [r.slug, r.name])), [researchers]);

  // A direction is "hot" when many tracked researchers are on it: head count
  // first, papers second; the catch-all always sits last.
  const chips = useMemo(
    () =>
      DIRECTIONS.map((d) => ({ d, ...tally(papers.filter((p) => p.directionId === d.id)) }))
        .filter((c) => c.papers > 0)
        .sort(
          (a, b) =>
            Number(a.d.id === OTHER_DIRECTION_ID) - Number(b.d.id === OTHER_DIRECTION_ID) ||
            b.people - a.people ||
            b.papers - a.papers
        ),
    [papers]
  );

  const haystack = useMemo(
    () => new Map(papers.map((p) => [p.id, `${p.title} ${p.abstract} ${p.authors.join(" ")}`.toLowerCase()])),
    [papers]
  );
  const q = query.trim().toLowerCase();
  const matches = (p: ViewPaper) => (!topic || p.directionId === topic) && (!q || haystack.get(p.id)!.includes(q));
  const filtering = Boolean(topic || q);
  const listed = papers.filter(matches);
  const rows: Row[] = people
    .map((r) => ({ r, hits: r.papers.filter(matches) }))
    .filter((row) => row.hits.length > 0)
    .sort((a, b) => b.hits.length - a.hits.length || b.r.papers[0]!.published.localeCompare(a.r.papers[0]!.published));
  const maxPapers = Math.max(1, ...people.map((r) => r.papers.length));

  function openDrawer(slug: string, from: HTMLElement, focusPaperId?: string) {
    opener.current = from;
    setDrawer({ slug, focusPaperId, showAll: false });
  }
  // Stable identity: the drawer's Esc/scroll-lock effect depends on it.
  const closeDrawer = useCallback(() => {
    setDrawer(null);
    opener.current?.focus();
  }, []);
  const person = drawer ? people.find((r) => r.slug === drawer.slug) : undefined;

  return (
    <section aria-labelledby="recent-papers-title" className="rounded bg-white shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pt-4">
        <h2 id="recent-papers-title" className="text-xs font-semibold uppercase tracking-[.06em] text-muted">
          {t("recentPapers")}
        </h2>
        <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2.5 max-[720px]:w-full">
          <div role="group" aria-label={t("viewLabel")} className="inline-flex rounded-md border border-border bg-white p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => chooseView(v)}
                className={`whitespace-nowrap rounded-sm px-2.5 py-0.5 text-[13px] ${
                  view === v ? "bg-accent/[0.08] font-medium text-accent" : "text-muted"
                }`}
              >
                {t(v)}
              </button>
            ))}
          </div>
          <label className="relative max-[720px]:w-full">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="absolute left-[9px] top-1/2 -translate-y-1/2 text-muted">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" />
              <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search")}
              aria-label={t("search")}
              className="w-[200px] max-w-full rounded-md border border-control bg-white py-[5px] pl-[30px] pr-2.5 text-[13px] max-[720px]:w-full"
            />
          </label>
        </div>
      </div>

      <div role="group" aria-label={t("filterLabel")} className="flex flex-wrap gap-1.5 px-5 pt-3">
        {chips.map(({ d, papers: count }) => {
          const pressed = topic === d.id;
          return (
            <button
              key={d.id}
              type="button"
              aria-pressed={pressed}
              onClick={() => setTopic(pressed ? null : d.id)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[13px] ${
                pressed ? "border-accent/35 bg-accent/[0.08] text-accent" : "border-border bg-surface hover:border-control"
              }`}
            >
              <Swatch color={d.color} />
              {w.label(d)}
              <span className={`text-xs tabular-nums ${pressed ? "text-accent" : "text-muted"}`}>{count}</span>
            </button>
          );
        })}
        {topic ? (
          <button
            type="button"
            onClick={() => setTopic(null)}
            className="inline-flex items-center whitespace-nowrap rounded-full border border-border bg-surface px-2.5 py-[3px] text-[13px] text-accent hover:border-control"
          >
            {t("showAll")}
          </button>
        ) : null}
      </div>

      <div className="mt-3 border-t border-border">
        {view === "list" ? (
          listed.length ? (
            <div className="px-5 pb-2">
              <PapersByMonth papers={listed} names={names} newSince={newSince} />
            </div>
          ) : (
            <p className="px-5 py-6 text-muted">{t("noMatches")}</p>
          )
        ) : rows.length === 0 ? (
          <p className="px-5 py-6 text-muted">{t("noMatches")}</p>
        ) : view === "bars" ? (
          rows.map((row) => (
            <BarRow
              key={row.r.slug}
              row={row}
              maxPapers={maxPapers}
              topic={topic}
              filtering={filtering}
              newSince={newSince}
              onOpen={(el) => openDrawer(row.r.slug, el)}
            />
          ))
        ) : (
          <Timeline rows={rows} filtering={filtering} windowFrom={windowFrom} windowTo={windowTo} newSince={newSince} onOpen={openDrawer} />
        )}
      </div>

      {drawer && person ? (
        <ResearcherDrawer
          key={drawer.slug}
          person={person}
          state={drawer}
          matches={matches}
          topic={topic}
          query={q}
          names={names}
          windowFrom={windowFrom}
          newSince={newSince}
          onShowAll={() => setDrawer({ ...drawer, showAll: true })}
          onClose={closeDrawer}
        />
      ) : null}
    </section>
  );
}

function BarRow({
  row,
  maxPapers,
  topic,
  filtering,
  newSince,
  onOpen
}: {
  row: Row;
  maxPapers: number;
  topic: string | null;
  filtering: boolean;
  newSince: string;
  onOpen: (el: HTMLElement) => void;
}) {
  const w = useWording();
  const { r, hits } = row;
  const latest = hits[0]!;
  return (
    <button
      type="button"
      onClick={(e) => onOpen(e.currentTarget)}
      className="grid w-full grid-cols-[210px_1fr_36px] items-center gap-5 border-b border-border px-5 py-3 text-left last:border-b-0 hover:bg-surface max-[720px]:grid-cols-[1fr_36px] max-[720px]:gap-y-2"
    >
      <span>
        <span className="block text-[14.5px] font-medium leading-snug">{r.name}</span>
        <span className="block text-xs text-muted">{r.affiliation}</span>
      </span>
      <span className="grid min-w-0 gap-1.5 max-[720px]:col-span-2 max-[720px]:row-start-2">
        <span
          role="img"
          aria-label={r.mix.map(([d, n]) => `${w.label(d)} ${n}`).join(", ")}
          className="flex h-2.5 gap-0.5"
          style={{ width: `max(${(r.papers.length / maxPapers) * 100}%, 24px)` }}
        >
          {r.mix.map(([d, n]) => (
            <i
              key={d.id}
              title={`${w.label(d)} · ${n}`}
              className={`block h-full rounded-[2px] ${topic && topic !== d.id ? "opacity-15" : ""}`}
              style={{ flex: n, background: d.color }}
            />
          ))}
        </span>
        <span className="truncate text-[12.5px] text-muted">
          {latest.published >= newSince ? <NewBadge /> : null}
          {w.fmtDay(latest.published)} · <span className="text-ink">{latest.title}</span>
        </span>
      </span>
      <span className="text-right text-base font-semibold tabular-nums max-[720px]:col-start-2 max-[720px]:row-start-1">
        {filtering ? hits.length : r.papers.length}
      </span>
    </button>
  );
}

function Timeline({
  rows,
  filtering,
  windowFrom,
  windowTo,
  newSince,
  onOpen
}: {
  rows: Row[];
  filtering: boolean;
  windowFrom: string;
  windowTo: string;
  newSince: string;
  onOpen: (slug: string, el: HTMLElement, focusPaperId?: string) => void;
}) {
  const w = useWording();
  const [tip, setTip] = useState<{ p: ViewPaper; left: number; top: number; width: number } | null>(null);
  useEffect(() => {
    const hide = () => setTip(null);
    window.addEventListener("scroll", hide, { passive: true });
    return () => window.removeEventListener("scroll", hide);
  }, []);

  const t0 = fromIsoDay(windowFrom).getTime();
  const t1 = fromIsoDay(windowTo).getTime() + DAY_MS;
  const xOf = (iso: string) => ((fromIsoDay(iso).getTime() + DAY_MS / 2 - t0) / (t1 - t0)) * 100;
  // Only month starts get a line; the last two weeks get the shaded band.
  const months: { x: number; date: Date }[] = [];
  for (let t = t0; t < t1; t += DAY_MS) {
    const date = new Date(t);
    if (date.getUTCDate() === 1) months.push({ x: ((t - t0) / (t1 - t0)) * 100, date });
  }
  const band = ((fromIsoDay(newSince).getTime() - t0) / (t1 - t0)) * 100;
  const background = (labels: boolean) => (
    <>
      <div className="absolute inset-y-0 right-0 bg-accent/[0.08]" style={{ left: `${band}%` }} />
      {months.map(({ x, date }) => (
        <Fragment key={x}>
          <div className="absolute inset-y-0 w-px bg-[#cfd7e3]" style={{ left: `${x}%` }} />
          {labels ? (
            <span className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap pl-[5px] text-[11.5px] text-muted" style={{ left: `${x}%` }}>
              {w.fmtMonth(date)}
            </span>
          ) : null}
        </Fragment>
      ))}
      {labels ? (
        <span className="absolute right-1 top-1/2 -translate-y-1/2 whitespace-nowrap text-[11.5px] font-semibold text-accent">
          {w.t("lastTwoWeeks")}
        </span>
      ) : null}
    </>
  );
  function showTip(el: HTMLElement, p: ViewPaper) {
    const b = el.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    const left = Math.max(12, Math.min(b.left + b.width / 2 - width / 2, window.innerWidth - width - 12));
    setTip({ p, width, left, top: b.bottom + 8 });
  }

  return (
    <>
      <div className="grid h-8 grid-cols-[210px_1fr_36px] items-center gap-5 border-b border-border px-5 max-[720px]:grid-cols-1">
        <span className="max-[720px]:hidden" />
        <div className="relative self-stretch">{background(true)}</div>
        <span className="max-[720px]:hidden" />
      </div>
      {rows.map(({ r, hits }) => {
        // Dots on nearby days stack alternately above and below the lane's centre.
        const placed: number[] = [];
        const dots = [...r.papers]
          .sort((a, b) => a.published.localeCompare(b.published))
          .map((p) => {
            const x = xOf(p.published);
            const level = placed.filter((px) => Math.abs(px - x) < 1.4).length;
            placed.push(x);
            return { p, x, offset: (level % 2 ? -1 : 1) * Math.ceil(level / 2) * 13 };
          });
        return (
          <div
            key={r.slug}
            className="grid min-h-[54px] grid-cols-[210px_1fr_36px] items-center gap-5 border-b border-border px-5 last:border-b-0 max-[720px]:grid-cols-[1fr_36px] max-[720px]:gap-y-0.5 max-[720px]:py-1.5"
          >
            <button type="button" onClick={(e) => onOpen(r.slug, e.currentTarget)} className="group py-2 text-left">
              <span className="block text-[14.5px] font-medium leading-snug group-hover:text-accent">{r.name}</span>
              <span className="block text-xs text-muted">{r.affiliation}</span>
            </button>
            <div className="relative min-h-8 self-stretch max-[720px]:col-span-2 max-[720px]:row-start-2 max-[720px]:h-[30px]">
              {background(false)}
              {dots.map(({ p, x, offset }) => (
                <button
                  key={p.id}
                  type="button"
                  aria-label={`${p.title} (${w.fmtDay(p.published)})`}
                  className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_0_2px_#fff] transition-transform hover:z-10 hover:scale-[1.35] ${
                    hits.includes(p) ? "" : "opacity-15"
                  }`}
                  style={{ left: `${x}%`, top: `calc(50% + ${offset}px)`, background: directionOf(p).color }}
                  onMouseEnter={(e) => showTip(e.currentTarget, p)}
                  onFocus={(e) => showTip(e.currentTarget, p)}
                  onMouseLeave={() => setTip(null)}
                  onBlur={() => setTip(null)}
                  onClick={(e) => {
                    setTip(null);
                    onOpen(r.slug, e.currentTarget, p.id);
                  }}
                />
              ))}
            </div>
            <span className="text-right text-base font-semibold tabular-nums max-[720px]:col-start-2 max-[720px]:row-start-1">
              {filtering ? hits.length : r.papers.length}
            </span>
          </div>
        );
      })}
      {tip ? (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 rounded-md bg-ink px-2.5 py-1.5 text-[12.5px] leading-snug text-white shadow-overlay"
          style={{ left: tip.left, top: tip.top, maxWidth: tip.width }}
        >
          <div>{tip.p.title}</div>
          <div className="mt-0.5 text-[#aeb9c7]">
            {w.fmtDay(tip.p.published)} · {w.label(directionOf(tip.p))} ·{" "}
            {tip.p.researchers.map((x) => w.role(x.position, tip.p.authors.length)).join(", ")}
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * The drawer inherits the page's direction filter and search, so opening a
 * row after filtering shows the papers that made it match; "Show all" lifts
 * the filter for this drawer only. A faded timeline dot's paper is not among
 * the hits, so that click shows everything.
 */
function ResearcherDrawer({
  person,
  state,
  matches,
  topic,
  query,
  names,
  windowFrom,
  newSince,
  onShowAll,
  onClose
}: {
  person: Person;
  state: DrawerState;
  matches: (p: ViewPaper) => boolean;
  topic: string | null;
  query: string;
  names: Map<string, string>;
  windowFrom: string;
  newSince: string;
  onShowAll: () => void;
  onClose: () => void;
}) {
  const w = useWording();
  const { t } = w;
  const closeRef = useRef<HTMLButtonElement>(null);
  const [flashId, setFlashId] = useState<string | undefined>();

  // Esc closes, the page behind stops scrolling, focus starts on the close button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  // A timeline dot opens the drawer at its paper, flashed briefly.
  useEffect(() => {
    if (!state.focusPaperId) return;
    document.getElementById(`rp-${state.focusPaperId}`)?.scrollIntoView({ block: "start" });
    setFlashId(state.focusPaperId);
    const timer = setTimeout(() => setFlashId(undefined), 1600);
    return () => clearTimeout(timer);
  }, [state.focusPaperId]);

  const hits = person.papers.filter(matches);
  const filtered =
    !state.showAll &&
    hits.length < person.papers.length &&
    !(state.focusPaperId && !hits.some((p) => p.id === state.focusPaperId));
  const list = filtered ? hits : person.papers;
  const topicDirection = topic ? BY_ID.get(topic) : undefined;
  const what = [topicDirection ? w.label(topicDirection) : null, query ? `"${query}"` : null].filter(Boolean).join(" · ");

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/[0.28]" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="researcher-drawer-name"
        className="fixed inset-y-0 right-0 z-[41] flex w-full max-w-[620px] flex-col bg-white shadow-overlay"
      >
        <div className="grid gap-2 border-b border-border px-5 pb-3.5 pt-[calc(16px+env(safe-area-inset-top,0px))]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="researcher-drawer-name" className="text-xl font-semibold leading-snug">{person.name}</h2>
              <div className="text-[12.5px] text-muted">
                {person.knownFor ? `${person.affiliation} · ${person.knownFor}` : person.affiliation}
              </div>
            </div>
            <button
              ref={closeRef}
              type="button"
              aria-label={t("close")}
              onClick={onClose}
              className="h-8 w-8 shrink-0 rounded-sm bg-surface text-lg leading-none text-muted hover:text-ink"
            >
              ×
            </button>
          </div>
          <div className="text-[12.5px] tabular-nums text-muted">
            {t("since", { count: person.papers.length, date: w.fmtDay(windowFrom) })} · {t("asLast", { count: person.asLast })} ·{" "}
            {person.mix.map(([d, n], i) => (
              <span key={d.id} className="inline-flex items-center gap-1">
                {i ? ", " : ""}
                <Swatch color={d.color} /> {w.label(d)} {n}
              </span>
            ))}
          </div>
        </div>
        <div key={String(state.showAll)} className="flex-1 overflow-y-auto px-5 pb-[calc(24px+env(safe-area-inset-bottom,0px))] pt-1">
          {filtered ? (
            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md bg-accent/[0.08] px-3 py-2 text-[13px]">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {t("showing", { shown: list.length, total: person.papers.length })} ·
                {topicDirection ? <Swatch color={topicDirection.color} /> : null} {what}
              </span>
              <button type="button" onClick={onShowAll} className="font-medium text-accent hover:underline">
                {t("showAllCount", { count: person.papers.length })}
              </button>
            </div>
          ) : null}
          <PapersByMonth papers={list} names={names} newSince={newSince} flashId={flashId} />
        </div>
      </aside>
    </>
  );
}

/** Papers, newest first, under a heading per month: a researcher's drawer, and the List view of everyone's. */
function PapersByMonth({
  papers,
  names,
  newSince,
  flashId
}: {
  papers: ViewPaper[];
  names: Map<string, string>;
  newSince: string;
  flashId?: string | undefined;
}) {
  const w = useWording();
  const groups = papers.reduce<{ month: string; papers: ViewPaper[] }[]>((acc, p) => {
    const month = p.published.slice(0, 7);
    const last = acc.at(-1);
    if (last?.month === month) last.papers.push(p);
    else acc.push({ month, papers: [p] });
    return acc;
  }, []);
  return (
    <>
      {groups.map((group) => (
        <section key={group.month}>
          <div className="mt-4 text-[11.5px] font-semibold uppercase tracking-[.06em] text-muted">
            {w.fmtMonthYear(`${group.month}-01`)}
          </div>
          {group.papers.map((p) => (
            <PaperRow key={p.id} p={p} names={names} isNew={p.published >= newSince} flash={flashId === p.id} />
          ))}
        </section>
      ))}
    </>
  );
}

function PaperRow({ p, names, isNew, flash }: { p: ViewPaper; names: Map<string, string>; isNew: boolean; flash: boolean }) {
  const w = useWording();
  const { t } = w;
  const [open, setOpen] = useState(false);
  const d = directionOf(p);
  const count = p.authors.length;
  return (
    <div
      id={`rp-${p.id}`}
      className={`grid gap-[5px] border-b border-border py-3 transition-colors duration-1000 last:border-b-0 ${flash ? "bg-accent/[0.08]" : ""}`}
    >
      <Link href={`/papers/${p.id}?from=researchers`} className="text-[14.5px] font-medium leading-snug hover:text-accent hover:underline">
        {isNew ? <NewBadge /> : null}
        {p.title}
      </Link>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted">
        <span>{w.fmtDay(p.published)}</span>
        <span className="inline-flex items-center gap-[5px] rounded-sm border border-border bg-surface px-[7px] text-ink">
          <Swatch color={d.color} />
          {w.label(d)}
        </span>
        {p.researchers.map((x) => {
          const lead = x.position === 1 || x.position === count;
          return (
            <span key={x.slug} className="text-ink">
              <b className="font-semibold">{names.get(x.slug)}</b>
              <span className={lead ? "font-medium text-accent" : "text-muted"}> · {w.role(x.position, count)}</span>
            </span>
          );
        })}
      </div>
      <AuthorLine authors={p.authors} tracked={new Set(p.researchers.map((x) => x.position - 1))} />
      <div className="flex items-center gap-3.5 text-[12.5px]">
        {p.abstract ? (
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="font-medium text-accent hover:underline">
            {open ? t("hideAbstract") : t("abstract")}
          </button>
        ) : null}
        <a href={`https://arxiv.org/abs/${p.arxivId}`} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">
          {t("arxiv")}
        </a>
        {p.inLibrary ? <InLibraryLink paperId={p.id} /> : <SaveToLibraryButton paperId={p.id} />}
      </div>
      {open ? <p className="max-w-[76ch] rounded-md bg-surface px-3 py-2.5 text-[13px] leading-[1.65]">{p.abstract}</p> : null}
    </div>
  );
}

/** Long author lists keep the first three, the last and every tracked author; gaps become "…". */
function AuthorLine({ authors, tracked }: { authors: string[]; tracked: ReadonlySet<number> }) {
  const { t } = useWording();
  const n = authors.length;
  const keep = n <= 8 ? authors.map((_, i) => i) : [...new Set([0, 1, 2, n - 1, ...tracked])].sort((a, b) => a - b);
  return (
    <div className="text-[12.5px] text-muted">
      {keep.map((i, k) => (
        <Fragment key={i}>
          {k ? (i - keep[k - 1]! > 1 ? ", …, " : ", ") : null}
          {tracked.has(i) ? <b className="font-semibold text-ink">{authors[i]}</b> : authors[i]}
        </Fragment>
      ))}
      {n > 8 ? ` · ${t("authorsCount", { count: n })}` : null}
    </div>
  );
}
