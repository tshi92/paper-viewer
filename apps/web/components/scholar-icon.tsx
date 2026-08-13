/**
 * Google Scholar's mark, for the "look this paper up" link on a catalog row.
 *
 * A row already carries the paper's title, its authors, a PDF badge and a save
 * action; the word "Scholar" among them read as one more label to parse, while
 * the mark is recognised without reading. The link keeps a text alternative —
 * the icon is `aria-hidden` and the anchor is labelled.
 */
export function ScholarIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 122.88 122.88"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <polygon fill="#4285F4" points="61.44,98.67 0,48.64 61.44,0 61.44,98.67" />
      <polygon fill="#356AC3" points="61.44,98.67 122.88,48.64 61.44,0 61.44,98.67" />
      <path
        fill="#A0C3FF"
        d="M97.28,87.04c0-19.79-16.05-35.84-35.84-35.84c-19.79,0-35.84,16.05-35.84,35.84s16.05,35.84,35.84,35.84 C81.23,122.88,97.28,106.83,97.28,87.04L97.28,87.04z"
      />
      <path
        fill="#76A7FA"
        d="M29.05,71.68C34.8,59.57,47.14,51.2,61.44,51.2c14.3,0,26.64,8.37,32.39,20.48H29.05L29.05,71.68z"
      />
    </svg>
  );
}
