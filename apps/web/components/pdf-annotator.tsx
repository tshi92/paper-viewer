"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ComponentType, CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { Highlight, PdfHighlighter, PdfLoader } from "react-pdf-highlighter";
import type { Content, IHighlight, LTWHP, Position, ScaledPosition } from "react-pdf-highlighter";
import "react-pdf-highlighter/dist/style.css";
import { annotationColor, DEFAULT_HIGHLIGHT_COLOR } from "@paper-viewer/core/labels";
import { LabelChip } from "./label-chip";
import { PdfZoomControls } from "./pdf-zoom-controls";
import type { AnnotationView, LabelView } from "@/lib/annotation-types";
import { extractPdfOutline, type OutlineCapableDocument, type PdfOutlineEntry } from "@/lib/pdf-outline";
import { MAX_SCALE, MIN_SCALE, PDF_WORKER_SRC, ZOOM_STEP } from "@/lib/pdf-viewer";

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

  /** Page-level jump for the outline panel (highlight jumps go via scrollRef). */
  scrollToPage(pageNumber: number) {
    this.viewer?.scrollPageIntoView({ pageNumber });
  }

  /**
   * PDF-only zoom, for reading a dense figure on a phone without blowing up
   * the whole page. Changing `currentScale` makes pdf.js re-rasterise at the
   * new size — sharp, unlike browser zoom — and the highlight layers re-render
   * from the new viewport, so annotations stay anchored. The clamp keeps a
   * runaway tap from rendering a 10× canvas. A window resize resets to
   * fit-width via the library's own handler, which is the right default there.
   */
  zoomBy(factor: number) {
    const { viewer } = this;
    if (!viewer) return;
    viewer.currentScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewer.currentScale * factor));
  }

  /** Back to the fit-the-container default. */
  zoomToFitWidth() {
    const { viewer } = this;
    if (!viewer) return;
    viewer.currentScaleValue = "page-width";
  }
}

/**
 * `PdfLoader` can hand a second document to the same `PdfHighlighter` instance —
 * StrictMode makes it load twice — and the library's own document-change path
 * re-inits in place, hitting the same viewer-versus-bus split described above.
 * Keying the highlighter on the document turns that into a clean remount.
 */
/**
 * Extracts the embedded bookmark outline once per document and reports it up.
 * Lives inside PdfLoader's render prop, which is the only place the document
 * proxy exists; renders nothing.
 */
function OutlineExtractor({
  pdfDocument,
  onOutline
}: {
  pdfDocument: OutlineCapableDocument;
  onOutline: (outline: PdfOutlineEntry[]) => void;
}) {
  useEffect(() => {
    let cancelled = false;
    void extractPdfOutline(pdfDocument).then((outline) => {
      if (!cancelled) onOutline(outline);
    });
    return () => {
      cancelled = true;
    };
  }, [pdfDocument, onOutline]);
  return null;
}

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
 * absolutely positioned parts — the text rects, or the area's box div —
 * measured in viewport coordinates so the card can be placed with
 * `position: fixed`, immune to the PDF's inner scrolling.
 *
 * The `position` test is what keeps the static wrappers out: they stretch to the
 * full layer width, and the area wrapper's 1px border even gives it a height, so
 * including them would anchor the card to the whole page instead of the mark.
 */
/**
 * Whether a viewport point lands on one of the wrapper's painted parts,
 * returning that part's area so overlapping annotations can resolve to the
 * most specific (smallest) one. Point-in-part, not point-in-union: the union
 * box of a multi-line highlight covers the gap between its lines.
 */
function hitAreaAtPoint(wrapper: HTMLElement, x: number, y: number): number | null {
  let best: number | null = null;
  for (const element of wrapper.querySelectorAll<HTMLElement>("*")) {
    if (getComputedStyle(element).position !== "absolute") continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
    const area = rect.width * rect.height;
    if (best === null || area < best) best = area;
  }
  return best;
}

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
/*
 * The whole highlight layer is transparent to the pointer: starting a text
 * selection on an already-highlighted sentence must anchor in the text layer
 * beneath (with pointer events on, the anchor landed on the highlight div and
 * dragging selected the entire page). Hover previews and click-to-select are
 * re-implemented with geometric hit-testing on the container instead.
 */
.pv-highlight,
.pv-highlight * {
  pointer-events: none !important;
}
.pv-highlight .Highlight__part {
  background: var(--pv-highlight-color, ${DEFAULT_HIGHLIGHT_COLOR}) !important;
  /* Light wash + multiply keeps the text underneath crisp and the colour
     recognisable without shouting; hover/selected only nudges it up. */
  opacity: 0.22;
  mix-blend-mode: multiply;
  transition: opacity 0.15s ease;
}
.pv-highlight:hover .Highlight__part,
.pv-highlight[data-scrolled-to="true"] .Highlight__part {
  opacity: 0.4;
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


function AnnotationPreview({ annotation }: { annotation: AnnotationView }) {
  const firstComment = annotation.comments[0];
  return (
    <div className="max-w-[260px] rounded border border-border bg-white p-2 text-xs shadow-overlay">
      <p className="text-muted">{annotation.author.name ?? annotation.author.email}</p>
      {/* Neither the quoted text nor the area screenshot: both reproduce what
          is already under the cursor. The preview carries only what the
          document cannot show — the labels and the discussion. */}
      {annotation.labels.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {annotation.labels.map((label) => (
            <LabelChip key={label.id} name={label.name} color={label.color} />
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
  onMount,
  onOpenChange
}: {
  labels: LabelView[];
  onConfirm: (labelIds: string[], firstComment?: string) => Promise<void>;
  onCancel: () => void;
  onMount: () => void;
  /** Reports the tip's lifetime so the container can suspend hover previews. */
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("annotations");
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const mountRef = useRef(onMount);
  mountRef.current = onMount;
  const openChangeRef = useRef(onOpenChange);
  openChangeRef.current = onOpenChange;

  // Freeze the selection as a ghost highlight while the user picks labels.
  useEffect(() => {
    mountRef.current();
    openChangeRef.current(true);
    return () => openChangeRef.current(false);
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
    <div className="w-64 rounded border border-border bg-white p-3 shadow-overlay">
      {labels.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {labels.map((label) => (
            <button
              key={label.id}
              type="button"
              aria-pressed={selectedLabelIds.includes(label.id)}
              onClick={() => toggleLabel(label.id)}
              className="rounded"
            >
              <LabelChip
                name={label.name}
                color={label.color}
                dimmed={!selectedLabelIds.includes(label.id)}
              />
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        className="mt-2 w-full rounded border border-control px-2 py-1 text-xs"
        rows={2}
        placeholder={t("tipCommentPlaceholder")} aria-label={t("tipCommentPlaceholder")}
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
          className="rounded bg-accent transition-transform duration-150 active:scale-[0.98] px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
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
  registerScrollTo,
  onOutline,
  registerScrollToPage
}: {
  pdfUrl: string;
  annotations: AnnotationView[];
  annotationLabels: LabelView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (input: CreateAnnotationInput) => Promise<void>;
  registerScrollTo?: (fn: (annotation: AnnotationView) => void) => void;
  /** Reports the document's embedded bookmark outline (possibly []) once loaded. */
  onOutline?: (outline: PdfOutlineEntry[]) => void;
  registerScrollToPage?: (fn: (page: number) => void) => void;
}) {
  const tPdf = useTranslations("pdf");

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

  // The highlight layer is pointer-transparent (see HIGHLIGHT_STYLES), so
  // hover and click resolve geometrically against the live DOM. Scanning the
  // container (rather than a ref registry) also covers the duplicate layer a
  // StrictMode remount leaves behind: whichever copy is painted where the
  // pointer is wins.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastHitIdRef = useRef<string | null>(null);
  const moveRafRef = useRef(0);

  const hitTest = useCallback((x: number, y: number) => {
    const container = containerRef.current;
    if (!container) return null;
    let best: { id: string; wrapper: HTMLElement; area: number } | null = null;
    for (const wrapper of container.querySelectorAll<HTMLElement>(".pv-highlight")) {
      const id = wrapper.dataset.annotationId;
      if (!id) continue;
      const area = hitAreaAtPoint(wrapper, x, y);
      if (area === null) continue;
      if (!best || area < best.area) best = { id, wrapper, area };
    }
    return best;
  }, []);

  const cancelPreviewClose = useCallback(() => {
    if (leaveTimerRef.current === null) return;
    clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = null;
  }, []);

  const closePreview = useCallback(() => {
    hoverWrapperRef.current = null;
    setHoverPreview(null);
  }, []);

  /** Whether the create-annotation tip is on screen; read inside a rAF callback. */
  const tipOpenRef = useRef(false);
  const setTipOpen = useCallback(
    (open: boolean) => {
      tipOpenRef.current = open;
      // A preview already on screen when the tip opens has to go too.
      if (open) {
        lastHitIdRef.current = null;
        cancelPreviewClose();
        closePreview();
      }
    },
    [cancelPreviewClose, closePreview]
  );

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
  useEffect(
    () => () => {
      if (moveRafRef.current) cancelAnimationFrame(moveRafRef.current);
    },
    []
  );

  const handleContainerMouseMove = useCallback(
    (event: ReactMouseEvent) => {
      const { clientX, clientY, buttons } = event;
      const target = event.target as HTMLElement | null;
      if (moveRafRef.current) return;
      moveRafRef.current = requestAnimationFrame(() => {
        moveRafRef.current = 0;
        // Mid-drag (text selection in progress): no previews in the way.
        if (buttons !== 0) {
          lastHitIdRef.current = null;
          schedulePreviewClose();
          return;
        }
        // The create-annotation tip is open. The reader is picking labels and
        // typing a first comment, and the tip covers the passage they just
        // selected — a preview for whatever highlight happens to sit under the
        // pointer would land on top of the form they are using.
        if (tipOpenRef.current) {
          lastHitIdRef.current = null;
          return;
        }
        if (target?.closest?.('[data-testid="annotation-hover-preview"]')) {
          cancelPreviewClose();
          return;
        }
        const hit = hitTest(clientX, clientY);
        if (hit && entries.has(hit.id)) {
          cancelPreviewClose();
          if (lastHitIdRef.current !== hit.id) {
            lastHitIdRef.current = hit.id;
            openPreview(hit.id, hit.wrapper);
          }
        } else {
          lastHitIdRef.current = null;
          schedulePreviewClose();
        }
      });
    },
    [cancelPreviewClose, entries, hitTest, openPreview, schedulePreviewClose]
  );

  const handleContainerClick = useCallback(
    (event: ReactMouseEvent) => {
      // A click that ends a text selection, or one inside the selection tip /
      // preview card, is not an annotation click.
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[data-testid="annotation-hover-preview"]')) return;
      if (target?.closest?.(".PdfHighlighter__tip-container")) return;
      const hit = hitTest(event.clientX, event.clientY);
      if (hit) onSelect(hit.id);
    },
    [hitTest, onSelect]
  );

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

  // Page jumps come from the outline panel; the instance ref survives the
  // StrictMode remount because the highlighter is keyed on the document.
  const highlighterRef = useRef<StablePdfHighlighter | null>(null);
  useEffect(() => {
    registerScrollToPage?.((page) => highlighterRef.current?.scrollToPage(page));
  }, [registerScrollToPage]);

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
        onOpenChange={setTipOpen}
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
    [annotationLabels, onCreate, setTipOpen]
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

      // Clicks are handled by the container's geometric hit test — these
      // elements are pointer-transparent and never see them.
      //
      // Area boxes are a plain absolutely-positioned div, not the library's
      // `AreaHighlight`: that component wraps react-rnd, whose drag/resize we
      // disable entirely — and whose rendering goes stale after a rescale
      // (fit-to-width in a resized window updates its size but keeps the old
      // translate, leaving the box drifted off the region it marks). A div is
      // a pure function of the freshly converted viewport position.
      const inner = isArea ? (
        <div
          style={{
            position: "absolute",
            left: highlight.position.boundingRect.left,
            top: highlight.position.boundingRect.top,
            width: highlight.position.boundingRect.width,
            height: highlight.position.boundingRect.height,
            background: color,
            border: `1.5px solid ${color}`,
            opacity: isScrolledTo ? 0.3 : 0.16,
            mixBlendMode: "multiply"
          }}
        />
      ) : (
        <Highlight
          position={highlight.position}
          comment={highlight.comment}
          isScrolledTo={isScrolledTo}
        />
      );

      // The wrapper carries its annotation id for the geometric hit test —
      // with the layer pointer-transparent it never receives mouse events.
      return (
        <div
          key={`${highlight.id}-${index}`}
          data-annotation-id={highlight.id}
          className="pv-highlight"
          data-annotation-type={isArea ? "area" : "highlight"}
          data-scrolled-to={isScrolledTo ? "true" : "false"}
          style={{ "--pv-highlight-color": color } as CSSProperties}
        >
          {inner}
        </div>
      );
    },
    [entries, selectedId]
  );

  return (
    <div
      ref={containerRef}
      className="relative h-[calc(100vh-3rem)] overflow-hidden rounded border border-border bg-surface"
      // Scroll does not bubble, but the PDF's inner container's does reach here
      // in the capture phase.
      onScrollCapture={repositionPreview}
      onMouseMove={handleContainerMouseMove}
      onClick={handleContainerClick}
      // The pointer leaving the container entirely produces no further
      // mousemoves, so the close must hook the leave itself. Entering the
      // preview card does not count as leaving — it is a DOM child.
      onMouseLeave={() => {
        lastHitIdRef.current = null;
        schedulePreviewClose();
      }}
    >
      <style>{HIGHLIGHT_STYLES}</style>
      <PdfZoomControls
        onZoomOut={() => highlighterRef.current?.zoomBy(1 / ZOOM_STEP)}
        onFitWidth={() => highlighterRef.current?.zoomToFitWidth()}
        onZoomIn={() => highlighterRef.current?.zoomBy(ZOOM_STEP)}
      />
      <PdfLoader
        workerSrc={PDF_WORKER_SRC}
        url={pdfUrl}
        beforeLoad={<p className="p-4 text-sm text-muted">{tPdf("loading")}</p>}
        errorMessage={<p className="p-4 text-sm text-muted">{tPdf("error")}</p>}
      >
        {(pdfDocument) => (
          <>
            {onOutline ? (
              <OutlineExtractor
                pdfDocument={pdfDocument as unknown as OutlineCapableDocument}
                onOutline={onOutline}
              />
            ) : null}
            <StablePdfHighlighter
              ref={highlighterRef}
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
          </>
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
          <AnnotationPreview annotation={previewEntry.annotation} />
        </div>
      ) : null}
    </div>
  );
}
