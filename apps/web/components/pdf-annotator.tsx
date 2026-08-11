"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ComponentType, CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { AreaHighlight, Highlight, PdfHighlighter, PdfLoader } from "react-pdf-highlighter";
import type { Content, IHighlight, LTWHP, Position, ScaledPosition } from "react-pdf-highlighter";
import "react-pdf-highlighter/dist/style.css";
import { annotationColor, DEFAULT_HIGHLIGHT_COLOR } from "@paper-viewer/core/labels";
import type { AnnotationView, LabelView } from "@/lib/annotation-types";

export type CreateAnnotationInput = {
  type: "highlight" | "area";
  pageNumber: number;
  position: unknown;
  quotedText?: string;
  /** PNG data URL of the selected region; area annotations only. */
  areaImage?: string;
  labelIds: string[];
  firstComment?: string;
};

/**
 * The API rejects screenshots above 500KB. A very large area selection can
 * exceed that, and losing the thumbnail is better than losing the annotation,
 * so oversized images are dropped rather than sent.
 */
const MAX_AREA_IMAGE_LENGTH = 500_000;

type ViewportHighlight = IHighlight & { position: Position };

/**
 * `AreaHighlight` forwards every unrecognised prop to its internal react-rnd
 * `<Rnd>`, but its exported prop type does not declare them. This alias exposes
 * the pass-through props we actually rely on.
 */
type AreaHighlightProps = {
  highlight: { content: Content; comment: { emoji: string; text: string }; position: Position };
  onChange: (rect: LTWHP) => void;
  isScrolledTo: boolean;
  disableDragging?: boolean;
  enableResizing?: boolean;
  style?: CSSProperties;
  onClick?: (event: ReactMouseEvent) => void;
};

const AreaHighlightBox = AreaHighlight as unknown as ComponentType<AreaHighlightProps>;

const noop = () => {};

/**
 * `scrollRef` is handed to us by `pagesinit`, so a jump requested while the
 * document is still laying itself out has nothing to call — and a jump to a page
 * the virtualised viewer has not built yet can miss for a moment too. One delayed
 * retry covers both without leaving a timer behind on every click.
 */
const SCROLL_RETRY_DELAY_MS = 300;

/**
 * `PdfHighlighter` cannot survive being mounted twice, which is exactly what
 * React StrictMode — Next's dev default — does. `componentDidMount` runs `init()`
 * again, and `init()` builds a fresh pdf.js `EventBus` while keeping the viewer
 * the first run created (`this.viewer = this.viewer || new PDFViewer(...)`). The
 * viewer therefore goes on dispatching to bus #1 while `attachRef` has just moved
 * every listener to bus #2, so `pagesinit` and `textlayerrendered` are never
 * delivered again. `pagesinit` is the only caller of `scrollRef`, which left
 * `scrollToRef` below permanently null: every sidebar jump silently did nothing,
 * and no highlight layer rendered until some unrelated prop change forced one.
 *
 * This subclass keeps one viewer bound to one bus. The first mount initialises as
 * usual; StrictMode's remount only re-subscribes to the bus the viewer actually
 * dispatches on, instead of building a second one.
 */
class StablePdfHighlighter extends PdfHighlighter<IHighlight> {
  private initialised = false;

  componentDidMount() {
    if (!this.initialised) {
      this.initialised = true;
      super.componentDidMount();
      return;
    }

    // A remount. `componentWillUnmount` has just dropped every listener, so put
    // them back — on the viewer's own bus. When the first `init()` is still in
    // flight there is no viewer yet and nothing to re-attach; that `init()`
    // subscribes on its own once it resolves.
    const { viewer } = this;
    if (!viewer) return;
    this.attachRef(viewer.eventBus);
    // `pagesinit` fires once per document and may already be past, so hand the
    // scroll callback out again by hand.
    if (viewer.pagesCount > 0) this.onDocumentReady();
    this.onTextLayerRendered();
  }
}

/**
 * `PdfLoader` can hand a second document to the same `PdfHighlighter` instance —
 * StrictMode makes it load twice — and the library's own document-change path
 * re-inits in place, hitting the same viewer-versus-bus split described above.
 * Keying the highlighter on the document turns that into a clean remount.
 */
const documentKeys = new WeakMap<object, string>();
let documentKeySeq = 0;
function documentKey(pdfDocument: object): string {
  const existing = documentKeys.get(pdfDocument);
  if (existing) return existing;
  documentKeySeq += 1;
  const key = `pdf-${documentKeySeq}`;
  documentKeys.set(pdfDocument, key);
  return key;
}

/**
 * Leaving a highlight keeps the preview alive this long, so crossing the seam
 * between two rects of the same highlight — or the gap on the way to the card —
 * does not flicker it away.
 */
const PREVIEW_LEAVE_DELAY_MS = 120;
/** Matches `AnnotationPreview`'s `max-w-[260px]`; used to keep the card on screen. */
const PREVIEW_WIDTH = 260;
/** Distance between the highlight and the card, filled with padding so the pointer never crosses dead space. */
const PREVIEW_GAP = 8;
/** Below this much room above the highlight, the card flips underneath it. */
const PREVIEW_FLIP_THRESHOLD = 160;

/** An annotation together with the colour every view of it paints with. */
type AnnotationEntry = { annotation: AnnotationView; color: string };

type PreviewPlacement = { left: number; top: number; below: boolean };

type HoverPreview = PreviewPlacement & { annotationId: string };

type Bounds = { left: number; top: number; right: number; bottom: number };

/**
 * A `.pv-highlight` wrapper is a static block whose children are all absolutely
 * positioned, so its own box is empty. The painted geometry is the union of the
 * absolutely positioned parts — the text rects, or the area's react-rnd box —
 * measured in viewport coordinates so the card can be placed with
 * `position: fixed`, immune to the PDF's inner scrolling.
 *
 * The `position` test is what keeps the static wrappers out: they stretch to the
 * full layer width, and the area wrapper's 1px border even gives it a height, so
 * including them would anchor the card to the whole page instead of the mark.
 */
function measureHighlightBounds(wrapper: HTMLElement): Bounds | null {
  let bounds: Bounds | null = null;
  for (const element of wrapper.querySelectorAll<HTMLElement>("*")) {
    if (getComputedStyle(element).position !== "absolute") continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    bounds = bounds
      ? {
          left: Math.min(bounds.left, rect.left),
          top: Math.min(bounds.top, rect.top),
          right: Math.max(bounds.right, rect.right),
          bottom: Math.max(bounds.bottom, rect.bottom)
        }
      : { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  }
  return bounds;
}

function placePreview(bounds: Bounds): PreviewPlacement {
  const half = PREVIEW_WIDTH / 2;
  const center = (bounds.left + bounds.right) / 2;
  const below = bounds.top < PREVIEW_FLIP_THRESHOLD;
  return {
    left: Math.min(Math.max(center, half + PREVIEW_GAP), window.innerWidth - half - PREVIEW_GAP),
    top: below ? bounds.bottom : bounds.top,
    below
  };
}

/**
 * The library keeps stable, unhashed BEM class names alongside its hashed CSS
 * module classes (`Highlight`, `Highlight__parts`, `Highlight__part`). We colour
 * text highlights by overriding `Highlight__part` from a per-highlight wrapper
 * that carries the colour in a CSS custom property. `!important` is required to
 * beat the module rules, including `._scrolledTo_… ._part_…`.
 */
const HIGHLIGHT_STYLES = `
.pv-highlight .Highlight__part {
  background: var(--pv-highlight-color, ${DEFAULT_HIGHLIGHT_COLOR}) !important;
  opacity: 0.45;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.pv-highlight:hover .Highlight__part,
.pv-highlight[data-scrolled-to="true"] .Highlight__part {
  opacity: 0.75;
}
`;

/**
 * Rendered highlights never round-trip through the library's `content.image`
 * path — `HighlightLayer` hands every highlight straight to `highlightTransform`
 * and `AreaHighlight` positions itself from `position.boundingRect`. Only the
 * live selection flow (`onSelectionFinished`) receives a screenshot, and the
 * library produces that itself. So area annotations carry empty content here and
 * their type is resolved from the annotation record instead.
 */
function toHighlight(annotation: AnnotationView): IHighlight {
  return {
    id: annotation.id,
    position: annotation.position as ScaledPosition,
    content: annotation.type === "area" ? {} : { text: annotation.quotedText ?? "" },
    comment: { text: annotation.comments[0]?.body ?? "", emoji: "" }
  };
}

function LabelChip({ label, dimmed = false }: { label: LabelView; dimmed?: boolean }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
      style={{ background: label.color, opacity: dimmed ? 0.4 : 1 }}
    >
      {label.name}
    </span>
  );
}

function AnnotationPreview({ annotation, color }: AnnotationEntry) {
  const t = useTranslations("annotations");
  const firstComment = annotation.comments[0];
  return (
    <div className="max-w-[260px] rounded border border-border bg-white p-2 text-xs shadow-lg">
      <p className="text-muted">{annotation.author.name ?? annotation.author.email}</p>
      {annotation.areaImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URL, not a routable asset
        <img
          src={annotation.areaImage}
          alt={t("areaImageAlt")}
          className="mt-1 max-h-16 w-auto rounded border border-border"
        />
      ) : null}
      {annotation.quotedText ? (
        <blockquote
          className="mt-1 border-l-2 pl-2 text-xs italic text-muted line-clamp-2"
          style={{ borderColor: color }}
        >
          &ldquo;{annotation.quotedText}&rdquo;
        </blockquote>
      ) : null}
      {annotation.labels.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {annotation.labels.map((label) => (
            <LabelChip key={label.id} label={label} />
          ))}
        </div>
      ) : null}
      {firstComment ? <p className="mt-1.5 line-clamp-3 text-ink">{firstComment.body}</p> : null}
    </div>
  );
}

function SelectionTip({
  labels,
  onConfirm,
  onCancel,
  onMount
}: {
  labels: LabelView[];
  onConfirm: (labelIds: string[], firstComment?: string) => Promise<void>;
  onCancel: () => void;
  onMount: () => void;
}) {
  const t = useTranslations("annotations");
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const mountRef = useRef(onMount);
  mountRef.current = onMount;

  // Freeze the selection as a ghost highlight while the user picks labels.
  useEffect(() => {
    mountRef.current();
  }, []);

  function toggleLabel(id: string) {
    setSelectedLabelIds((current) =>
      current.includes(id) ? current.filter((it) => it !== id) : [...current, id]
    );
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const trimmed = comment.trim();
      await onConfirm(selectedLabelIds, trimmed ? trimmed : undefined);
    } catch {
      // Save failed: the workspace banner reports it; keep the tip open so
      // the selection, chosen labels and typed comment are not lost.
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-64 rounded border border-border bg-white p-3 shadow-lg">
      {labels.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {labels.map((label) => (
            <button
              key={label.id}
              type="button"
              onClick={() => toggleLabel(label.id)}
              className="rounded"
            >
              <LabelChip label={label} dimmed={!selectedLabelIds.includes(label.id)} />
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        className="mt-2 w-full rounded border border-border px-2 py-1 text-xs"
        rows={2}
        placeholder={t("tipCommentPlaceholder")}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          className="rounded border border-border px-2 py-1 text-xs hover:bg-surface"
          onClick={onCancel}
          disabled={saving}
        >
          {t("tipCancel")}
        </button>
        <button
          type="button"
          className="rounded bg-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
          onClick={handleSave}
          disabled={saving}
        >
          {t("tipSave")}
        </button>
      </div>
    </div>
  );
}

export function PdfAnnotator({
  pdfUrl,
  annotations,
  annotationLabels,
  selectedId,
  onSelect,
  onCreate,
  registerScrollTo
}: {
  pdfUrl: string;
  annotations: AnnotationView[];
  annotationLabels: LabelView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (input: CreateAnnotationInput) => Promise<void>;
  registerScrollTo?: (fn: (annotation: AnnotationView) => void) => void;
}) {
  const t = useTranslations("annotations");

  // Everything derived from the server's annotations is built in one pass: the
  // shapes the library renders, and the record plus resolved colour that every
  // mark and hover card reads back.
  const { highlights, entries } = useMemo(() => {
    const built = new Map<string, AnnotationEntry>();
    return {
      highlights: annotations.map((annotation) => {
        built.set(annotation.id, { annotation, color: annotationColor(annotation.labels) });
        return toHighlight(annotation);
      }),
      entries: built
    };
  }, [annotations]);

  // The scroll callbacks below outlive the render that created them, so they read
  // the highlights through a ref rather than a closure.
  const highlightsRef = useRef<IHighlight[]>(highlights);
  highlightsRef.current = highlights;

  const scrollToRef = useRef<((highlight: IHighlight) => void) | null>(null);

  // The library's own `Popup`/`setTip` path is unreliable: it suppresses the tip
  // whenever a text selection is open, and its `MouseMonitor` closes on a stale
  // `mouseIn` closure. The preview below is owned end to end instead.
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** The hovered `.pv-highlight`, kept for repositioning; null while no card is up. */
  const hoverWrapperRef = useRef<HTMLElement | null>(null);

  const cancelPreviewClose = useCallback(() => {
    if (leaveTimerRef.current === null) return;
    clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = null;
  }, []);

  const closePreview = useCallback(() => {
    hoverWrapperRef.current = null;
    setHoverPreview(null);
  }, []);

  const openPreview = useCallback(
    (annotationId: string, wrapper: HTMLElement) => {
      cancelPreviewClose();
      const bounds = measureHighlightBounds(wrapper);
      if (!bounds) return;
      hoverWrapperRef.current = wrapper;
      setHoverPreview({ annotationId, ...placePreview(bounds) });
    },
    [cancelPreviewClose]
  );

  /**
   * The card is viewport-positioned while the PDF scrolls inside its own
   * container, so it has to follow its highlight — and drop itself when pdf.js
   * tears the page's layer down, which happens without a mouse-leave.
   */
  const repositionPreview = useCallback(() => {
    const wrapper = hoverWrapperRef.current;
    if (!wrapper) return;
    const bounds = wrapper.isConnected ? measureHighlightBounds(wrapper) : null;
    if (!bounds) {
      closePreview();
      return;
    }
    setHoverPreview((current) => (current ? { ...current, ...placePreview(bounds) } : current));
  }, [closePreview]);

  const schedulePreviewClose = useCallback(() => {
    cancelPreviewClose();
    leaveTimerRef.current = setTimeout(() => {
      leaveTimerRef.current = null;
      closePreview();
    }, PREVIEW_LEAVE_DELAY_MS);
  }, [cancelPreviewClose, closePreview]);

  useEffect(() => cancelPreviewClose, [cancelPreviewClose]);

  // A deleted annotation must not leave its card hanging.
  const previewEntry = hoverPreview ? entries.get(hoverPreview.annotationId) : undefined;

  const scrollRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The last id actually scrolled to, so one selection never scrolls twice. */
  const lastScrolledIdRef = useRef<string | null>(null);

  const scrollToId = useCallback((annotationId: string) => {
    if (scrollRetryRef.current !== null) {
      clearTimeout(scrollRetryRef.current);
      scrollRetryRef.current = null;
    }

    const attempt = () => {
      const scrollTo = scrollToRef.current;
      const target = highlightsRef.current.find((it) => it.id === annotationId);
      if (!scrollTo || !target) return false;
      lastScrolledIdRef.current = annotationId;
      scrollTo(target);
      return true;
    };

    if (attempt()) return;
    scrollRetryRef.current = setTimeout(() => {
      scrollRetryRef.current = null;
      attempt();
    }, SCROLL_RETRY_DELAY_MS);
  }, []);

  useEffect(
    () => () => {
      if (scrollRetryRef.current !== null) clearTimeout(scrollRetryRef.current);
    },
    []
  );

  const scrollToAnnotation = useCallback(
    (annotation: AnnotationView) => scrollToId(annotation.id),
    [scrollToId]
  );

  useEffect(() => {
    registerScrollTo?.(scrollToAnnotation);
  }, [registerScrollTo, scrollToAnnotation]);

  // Selecting from anywhere but the sidebar — creating an annotation, clicking a
  // mark — has to bring the target into view too. The sidebar's own jump has
  // already run by the time this fires and recorded the id, so it is not
  // repeated. Scroll only when the selection itself changes: the 30s poll
  // rebuilds `highlights` with a fresh identity, and reacting to that would yank
  // the reader back to the selected annotation every poll tick.
  useEffect(() => {
    if (!selectedId) {
      lastScrolledIdRef.current = null;
      return;
    }
    if (lastScrolledIdRef.current === selectedId) return;
    if (!highlights.some((it) => it.id === selectedId)) return;
    scrollToId(selectedId);
  }, [selectedId, highlights, scrollToId]);

  const handleSelectionFinished = useCallback(
    (
      position: ScaledPosition,
      content: Content,
      hideTipAndSelection: () => void,
      transformSelection: () => void
    ) => (
      <SelectionTip
        labels={annotationLabels}
        onCancel={hideTipAndSelection}
        onMount={transformSelection}
        onConfirm={async (labelIds, firstComment) => {
          await onCreate({
            type: content.image ? "area" : "highlight",
            pageNumber: position.pageNumber,
            position,
            labelIds,
            ...(content.text ? { quotedText: content.text } : {}),
            ...(content.image && content.image.length <= MAX_AREA_IMAGE_LENGTH
              ? { areaImage: content.image }
              : {}),
            ...(firstComment ? { firstComment } : {})
          });
          hideTipAndSelection();
        }}
      />
    ),
    [annotationLabels, onCreate]
  );

  const renderHighlight = useCallback(
    (highlight: ViewportHighlight, index: number) => {
      const entry = entries.get(highlight.id);
      const color = entry?.color ?? DEFAULT_HIGHLIGHT_COLOR;
      const isScrolledTo = selectedId === highlight.id;

      // Persisted highlights resolve their kind from the annotation record; the
      // library's transient ghost highlight has no record, and for those an
      // `image` is the only area marker available.
      const isArea = entry ? entry.annotation.type === "area" : Boolean(highlight.content?.image);

      const inner = isArea ? (
        <AreaHighlightBox
          highlight={highlight}
          onChange={noop}
          isScrolledTo={isScrolledTo}
          disableDragging={true}
          enableResizing={false}
          style={{
            background: color,
            opacity: isScrolledTo ? 0.5 : 0.35,
            cursor: "pointer"
          }}
          onClick={(event) => {
            event.stopPropagation();
            event.preventDefault();
            onSelect(highlight.id);
          }}
        />
      ) : (
        <Highlight
          position={highlight.position}
          comment={highlight.comment}
          isScrolledTo={isScrolledTo}
          onClick={() => onSelect(highlight.id)}
        />
      );

      // Hover lands on the painted parts (a text rect, or the area's react-rnd
      // box) and bubbles up here; React derives enter/leave from the DOM tree,
      // so the wrapper sees them even though its own box is empty.
      return (
        <div
          key={`${highlight.id}-${index}`}
          className="pv-highlight"
          data-annotation-type={isArea ? "area" : "highlight"}
          data-scrolled-to={isScrolledTo ? "true" : "false"}
          style={{ "--pv-highlight-color": color } as CSSProperties}
          onMouseEnter={
            entry ? (event) => openPreview(highlight.id, event.currentTarget) : undefined
          }
          onMouseLeave={entry ? schedulePreviewClose : undefined}
        >
          {inner}
        </div>
      );
    },
    [entries, onSelect, openPreview, schedulePreviewClose, selectedId]
  );

  return (
    <div
      className="relative h-[calc(100vh-200px)] overflow-hidden rounded border border-border bg-surface"
      // Scroll does not bubble, but the PDF's inner container's does reach here
      // in the capture phase.
      onScrollCapture={repositionPreview}
    >
      <style>{HIGHLIGHT_STYLES}</style>
      <PdfLoader
        workerSrc="/pdf.worker.min.mjs"
        url={pdfUrl}
        beforeLoad={<p className="p-4 text-sm text-muted">{t("pdfLoading")}</p>}
        errorMessage={<p className="p-4 text-sm text-muted">{t("pdfError")}</p>}
      >
        {(pdfDocument) => (
          <StablePdfHighlighter
            key={documentKey(pdfDocument)}
            pdfDocument={pdfDocument}
            highlights={highlights}
            pdfScaleValue="page-width"
            onScrollChange={noop}
            scrollRef={(scrollTo) => {
              scrollToRef.current = scrollTo;
            }}
            enableAreaSelection={(event) => event.altKey}
            onSelectionFinished={handleSelectionFinished}
            highlightTransform={renderHighlight}
          />
        )}
      </PdfLoader>
      {hoverPreview && previewEntry ? (
        <div
          data-testid="annotation-hover-preview"
          className="fixed z-30"
          style={{
            left: hoverPreview.left,
            top: hoverPreview.top,
            transform: hoverPreview.below ? "translate(-50%, 0)" : "translate(-50%, -100%)",
            // Padding, not a margin, so the pointer can reach the card without
            // ever leaving a hovered element.
            paddingTop: hoverPreview.below ? PREVIEW_GAP : 0,
            paddingBottom: hoverPreview.below ? 0 : PREVIEW_GAP
          }}
          onMouseEnter={cancelPreviewClose}
          onMouseLeave={schedulePreviewClose}
        >
          <AnnotationPreview annotation={previewEntry.annotation} color={previewEntry.color} />
        </div>
      ) : null}
    </div>
  );
}
