import { describe, expect, it } from "vitest";
import {
  labelScopes,
  annotationTypes,
  DEFAULT_ANNOTATION_LABELS,
  DEFAULT_HIGHLIGHT_COLOR,
  PAPER_LABEL_PALETTE,
  annotationColor,
  labelChipColors,
  paletteColorFor
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

  describe("labelChipColors", () => {
    // WCAG relative-luminance helpers, kept local so the test does its own math.
    function channel(v: number): number {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }
    function luminanceOf(rgb: [number, number, number]): number {
      return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
    }
    function parse(hex: string): [number, number, number] {
      const n = parseInt(hex.slice(1), 16);
      return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
    }
    function contrastOn(background: string, text: string, alpha: number): number {
      // Composite the tinted background over white before measuring.
      const bg = parse(background).map((c) => Math.round(255 * (1 - alpha) + c * alpha)) as [
        number,
        number,
        number
      ];
      const [lighter, darker] = [luminanceOf(bg), luminanceOf(parse(text))].sort((a, b) => b - a);
      return (lighter! + 0.05) / (darker! + 0.05);
    }

    it("meets WCAG AA on every palette color and on hostile inputs", () => {
      const hostile = ["#ffff00", "#00ff00", "#000000", "#ffffff", DEFAULT_HIGHLIGHT_COLOR];
      for (const color of [...PAPER_LABEL_PALETTE, ...hostile]) {
        const chip = labelChipColors(color);
        expect(
          contrastOn(color, chip.text, chip.alpha),
          `text ${chip.text} on ${color} tint`
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("keeps the hue recognisable in the derived text color", () => {
      const blue = labelChipColors("#3b82f6");
      const [r, , b] = (() => {
        const n = parseInt(blue.text.slice(1), 16);
        return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
      })();
      expect(b).toBeGreaterThan(r); // still reads as blue
    });

    it("accepts short hex and survives garbage input", () => {
      expect(labelChipColors("#00f").text).toMatch(/^#[0-9a-f]{6}$/);
      const fallback = labelChipColors("not-a-color");
      expect(fallback.text).toBe("#1d2733");
    });
  });

  describe("paletteColorFor", () => {
    it("gives one seed the same color everywhere, whatever its casing or spacing", () => {
      expect(paletteColorFor("kv cache")).toBe(paletteColorFor("KV Cache"));
      expect(paletteColorFor("kv cache")).toBe(paletteColorFor("  kv   cache "));
    });

    it("only ever returns a palette color, including for an empty seed", () => {
      const palette = new Set<string>(PAPER_LABEL_PALETTE);
      for (const seed of ["", "a@example.com", "zoe@example.com", "分布式训练", "a", "🧪"]) {
        expect(palette.has(paletteColorFor(seed))).toBe(true);
      }
    });

    it("spreads a realistic set of seeds over most of the palette", () => {
      // A single hue for everything would defeat the point: the colour is what
      // tells two teammates apart in a dense thread.
      const seeds = [
        "kv cache",
        "llm serving",
        "scheduling",
        "speculative decoding",
        "inference",
        "throughput",
        "checkpointing",
        "distributed training",
        "fault tolerance",
        "quantization",
        "attention",
        "memory management"
      ];
      const used = new Set(seeds.map(paletteColorFor));
      expect(used.size).toBeGreaterThanOrEqual(6);
    });

    it("does not collapse anagrams onto one color", () => {
      expect(paletteColorFor("cache")).not.toBe(paletteColorFor("chace"));
    });
  });
});
