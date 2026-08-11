"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ComponentType, CSSProperties, MouseEvent as ReactMouseEvent, ReactElement } from "react";
import {
  AreaHighlight,
  Highlight,
  PdfHighlighter,
  PdfLoader,
  Popup
} from "react-pdf-highlighter";
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

function LabelChip({ label, dimmed }: { label: LabelView; dimmed: boolean }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
      style={{ background: label.color, opacity: dimmed ? 0.4 : 1 }}
    >
      {label.name}
    </span>
  );
}

function AnnotationPreview({ annotation }: { annotation: AnnotationView }) {
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
      {annotation.labels.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {annotation.labels.map((label) => (
            <LabelChip key={label.id} label={label} dimmed={false} />
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
  const highlights = useMemo(() => annotations.map(toHighlight), [annotations]);
  const annotationById = useMemo(
    () => new Map(annotations.map((annotation) => [annotation.id, annotation])),
    [annotations]
  );

  const highlightsRef = useRef<IHighlight[]>(highlights);
  const scrollToRef = useRef<((highlight: IHighlight) => void) | null>(null);

  useEffect(() => {
    highlightsRef.current = highlights;
  }, [highlights]);

  const scrollToAnnotation = useCallback((annotation: AnnotationView) => {
    const target = highlightsRef.current.find((it) => it.id === annotation.id);
    if (target) scrollToRef.current?.(target);
  }, []);

  useEffect(() => {
    registerScrollTo?.(scrollToAnnotation);
  }, [registerScrollTo, scrollToAnnotation]);

  // Scroll only when the selection itself changes. The 30s poll rebuilds
  // `highlights` with a fresh identity, and reacting to that would yank the
  // reader back to the selected annotation every poll tick.
  const lastScrolledIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId) {
      lastScrolledIdRef.current = null;
      return;
    }
    if (lastScrolledIdRef.current === selectedId) return;
    const target = highlights.find((it) => it.id === selectedId);
    if (!target) return;
    lastScrolledIdRef.current = selectedId;
    scrollToRef.current?.(target);
  }, [selectedId, highlights]);

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
    (
      highlight: ViewportHighlight,
      index: number,
      setTip: (
        highlight: ViewportHighlight,
        callback: (highlight: ViewportHighlight) => ReactElement
      ) => void,
      hideTip: () => void
    ) => {
      const annotation = annotationById.get(highlight.id);
      const color = annotation ? annotationColor(annotation.labels) : DEFAULT_HIGHLIGHT_COLOR;
      const isScrolledTo = selectedId === highlight.id;
      const showPopup = (popupContent: ReactElement) => setTip(highlight, () => popupContent);
      const popupContent = annotation ? <AnnotationPreview annotation={annotation} /> : <span />;

      // Persisted highlights resolve their kind from the annotation record; the
      // library's transient ghost highlight has no record, and for those an
      // `image` is the only area marker available.
      const isArea = annotation ? annotation.type === "area" : Boolean(highlight.content?.image);

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

      return (
        <div
          key={`${highlight.id}-${index}`}
          className="pv-highlight"
          data-annotation-type={isArea ? "area" : "highlight"}
          data-scrolled-to={isScrolledTo ? "true" : "false"}
          style={{ "--pv-highlight-color": color } as CSSProperties}
        >
          <Popup popupContent={popupContent} onMouseOver={showPopup} onMouseOut={hideTip}>
            {inner}
          </Popup>
        </div>
      );
    },
    [annotationById, onSelect, selectedId]
  );

  return (
    <div className="relative h-[calc(100vh-200px)] overflow-hidden rounded border border-border bg-surface">
      <style>{HIGHLIGHT_STYLES}</style>
      <PdfLoader
        workerSrc="/pdf.worker.min.mjs"
        url={pdfUrl}
        beforeLoad={<p className="p-4 text-sm text-muted">{t("pdfLoading")}</p>}
        errorMessage={<p className="p-4 text-sm text-muted">{t("pdfError")}</p>}
      >
        {(pdfDocument) => (
          <PdfHighlighter<IHighlight>
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
    </div>
  );
}
