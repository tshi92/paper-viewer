import { labelChipColors } from "@paper-viewer/core/labels";

/**
 * The one way a label name is rendered anywhere in the app: light tint of the
 * label color, dark same-hue text (WCAG AA for any user-chosen color — solid
 * mid-tone chips can't get there), and a solid dot carrying the raw hue.
 */
export function LabelChip({
  name,
  color,
  dimmed = false
}: {
  name: string;
  color: string;
  dimmed?: boolean;
}) {
  const chip = labelChipColors(color);
  // "Dimmed" (unselected in a picker) keeps the text at full contrast and
  // signals the state with a dashed outline instead — a washed-out chip would
  // drop below AA and read as disabled.
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-medium ${
        dimmed ? "border-dashed border-control bg-transparent" : "border-transparent"
      }`}
      style={dimmed ? { color: chip.text } : { background: chip.background, color: chip.text }}
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      {name}
    </span>
  );
}
