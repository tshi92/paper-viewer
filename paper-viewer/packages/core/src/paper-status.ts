export const readingStates = ["new", "reading", "saved", "discussed", "skipped", "archived"] as const;

export type ReadingState = (typeof readingStates)[number];

export function isReadingState(value: string): value is ReadingState {
  return readingStates.includes(value as ReadingState);
}
