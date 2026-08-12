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
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium"
      style={{ background: chip.background, color: chip.text, opacity: dimmed ? 0.45 : 1 }}
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      {name}
    </span>
  );
}
