import { describe, expect, it } from "vitest";
import {
  labelScopes,
  annotationTypes,
  DEFAULT_ANNOTATION_LABELS,
  DEFAULT_HIGHLIGHT_COLOR,
  annotationColor
} from "../src/labels";

describe("labels", () => {
  it("defines both scopes and both annotation types", () => {
    expect(labelScopes).toEqual(["annotation", "paper"]);
    expect(annotationTypes).toEqual(["highlight", "area"]);
  });

  it("provides five default annotation labels with unique colors", () => {
    expect(DEFAULT_ANNOTATION_LABELS.map((l) => l.name)).toEqual([
      "method",
      "result",
      "question",
      "important",
      "idea"
    ]);
    const colors = DEFAULT_ANNOTATION_LABELS.map((l) => l.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("annotationColor returns first label color, falling back to default yellow", () => {
    expect(annotationColor([{ color: "#3b82f6" }, { color: "#ef4444" }])).toBe("#3b82f6");
    expect(annotationColor([])).toBe(DEFAULT_HIGHLIGHT_COLOR);
  });
});
