"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

/**
 * The floating controls over a PDF pane: zoom, and — where annotating is
 * possible — a way into area selection.
 *
 * Down the left edge and vertically centred rather than in a corner. The pane
 * is a viewport tall but starts below the paper's header card, so anything
 * pinned to its bottom edge sits under the fold on a phone: the buttons were
 * there but unreachable without scrolling the page first.
 *
 * Shared by the annotating viewer and the read-only preview so a paper zooms
 * the same way whether or not it is in the library.
 */
export function PdfControls({
  onZoomIn,
  onFitWidth,
  onZoomOut,
  areaMode,
  onToggleAreaMode
}: {
  onZoomIn: () => void;
  onFitWidth: () => void;
  onZoomOut: () => void;
  /** Omitted by the read-only preview, which has nothing to annotate. */
  areaMode?: boolean;
  onToggleAreaMode?: () => void;
}) {
  const t = useTranslations("pdf");

  return (
    // Deliberately not `overflow-hidden`, which would be the usual way to keep
    // a pressed button's fill inside the rounded corners: it also clips the
    // tooltips, and a transformed ancestor means even a fixed-position one
    // cannot escape. The one button that fills is rounded by hand instead.
    <div className="absolute left-3 top-1/2 z-30 flex -translate-y-1/2 flex-col rounded-md border border-border bg-white shadow-overlay">
      {onToggleAreaMode ? (
        <RailButton
          label={t("areaSelect")}
          hint={t("areaSelectHint")}
          pressed={areaMode ?? false}
          onClick={onToggleAreaMode}
          className="rounded-t-[5px]"
        >
          <AreaSelectIcon />
        </RailButton>
      ) : null}
      <RailButton label={t("zoomIn")} onClick={onZoomIn}>
        +
      </RailButton>
      <RailButton label={t("zoomFitWidth")} onClick={onFitWidth}>
        <span className="text-xs">{t("zoomFitWidthShort")}</span>
      </RailButton>
      <RailButton label={t("zoomOut")} onClick={onZoomOut}>
        −
      </RailButton>
    </div>
  );
}

/**
 * One button in the rail, with a tooltip beside it.
 *
 * The tooltip is drawn rather than left to the browser's `title`, because the
 * area button has a second thing to say — that a pointer can skip the button
 * and hold ⌥ instead — and a native tooltip appears too late, and only after a
 * second of stillness, to teach anyone that.
 */
function RailButton({
  label,
  hint,
  pressed,
  onClick,
  className,
  children
}: {
  label: string;
  hint?: string;
  pressed?: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    // The wrapper is the rail's flex child, so the divider belongs on it — on
    // the button it would never match `:first-child`.
    <div className="group relative flex border-border [&:not(:first-child)]:border-t">
      <button
        type="button"
        aria-label={label}
        {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
        onClick={onClick}
        className={`flex h-8 w-8 items-center justify-center border-border text-base transition-colors duration-150 ${
          pressed ? "bg-accent text-white" : "text-muted hover:bg-surface hover:text-ink"
        } ${className ?? ""}`}
      >
        {children}
      </button>
      {/* Pointer only: a tooltip that needs hover has nothing to say on a
          touch screen, where it would either never show or stick after a tap.
          Keyed to `:focus-visible` rather than focus, and gone once the button
          is pressed: clicking focuses it, and the tooltip would then sit parked
          over the document for as long as the tool stayed armed — which is
          precisely when it is in the way of using it. */}
      {pressed ? null : (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-full top-1/2 ml-2 hidden w-max max-w-[15rem] -translate-y-1/2 rounded border border-border bg-white px-2 py-1 text-xs leading-relaxed text-ink opacity-0 shadow-overlay transition-opacity duration-150 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 [@media(hover:hover)]:block"
        >
          <span className="font-medium">{label}</span>
          {hint ? <span className="block text-muted">{hint}</span> : null}
        </span>
      )}
    </div>
  );
}

/** A dashed box: the region an area annotation marks. */
function AreaSelectIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
      <rect
        x="1.5"
        y="2.5"
        width="13"
        height="11"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="3 2.5"
      />
    </svg>
  );
}
