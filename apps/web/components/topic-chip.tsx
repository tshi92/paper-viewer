/**
 * The one way a topic word is rendered anywhere in the app: model-generated
 * keywords on a digest card, workspace tags on a library row, the tag row on a
 * paper page.
 *
 * Deliberately neutral. Colour in this app means a *chosen* label (see
 * LabelChip, whose hue the reader picked and which therefore carries meaning);
 * topics are written by the model, and tinting them would put the loudest
 * colour on the page's least deliberate metadata.
 */
export function TopicChip({ topic, size = "md" }: { topic: string; size?: "sm" | "md" }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-md bg-surface text-muted ${
        size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-0.5 text-xs"
      }`}
    >
      {topic}
    </span>
  );
}
