import { labelChipColors, paletteColorFor } from "@paper-viewer/core/labels";

/**
 * Up to two initials. CJK names have no word boundaries, so they take the first
 * character; Latin names take the first letter of the first and last word
 * ("Ada Lovelace" → "AL"). Exported for tests.
 */
export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  if (/[㐀-鿿぀-ヿ가-힯]/.test(trimmed[0]!)) {
    return trimmed[0]!;
  }
  const words = trimmed.split(/[\s._@-]+/).filter(Boolean);
  const first = words[0]![0]!;
  const last = words.length > 1 ? words[words.length - 1]![0]! : "";
  return (first + last).toUpperCase();
}

const SIZES = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-7 w-7 text-[11px]"
} as const;

/**
 * A person, wherever one is named: the app header, an annotation card, a
 * comment. The color is derived from the email, so one teammate keeps one
 * color across the app and survives a rename — and two names that look alike
 * in a dense thread are still told apart.
 */
export function Avatar({
  name,
  email,
  size = "sm"
}: {
  name: string | null;
  email: string;
  size?: keyof typeof SIZES;
}) {
  const color = labelChipColors(paletteColorFor(email));
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${SIZES[size]}`}
      style={{ background: color.background, color: color.text }}
    >
      {initials(name ?? email)}
    </span>
  );
}
