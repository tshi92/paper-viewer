import { describe, expect, it } from "vitest";
import { canvasCropRect } from "./pdf-viewer";

/**
 * An area annotation's thumbnail is cut out of the page's rendered canvas. The
 * region arrives in CSS pixels and the canvas is in device pixels, so the crop
 * turns on one number: how much bigger the canvas is than its own display size.
 *
 * react-pdf-highlighter takes that number from `window.devicePixelRatio`. pdf.js
 * does not promise to render at the display's ratio — it caps canvas area, so a
 * large page on a high-ratio screen is rasterised smaller — and when the two
 * disagree the read runs off the canvas and comes back transparent. Nothing
 * throws; the annotation saves with a blank picture attached.
 */
describe("cropping a region out of a page canvas", () => {
  const region = { left: 100, top: 50, width: 200, height: 120 };

  it("scales the region into the canvas's own pixels", () => {
    expect(canvasCropRect(region, 2, 1200, 1600)).toEqual({
      left: 200,
      top: 100,
      width: 400,
      height: 240
    });
  });

  it("reads a canvas rendered at the display's ratio exactly", () => {
    expect(canvasCropRect(region, 1, 600, 800)).toEqual(region);
  });

  /**
   * The failure this function exists for: at ratio 3 the page would need 1800
   * pixels of canvas, pdf.js rendered 900, and the assumed crop starts beyond
   * the right edge entirely.
   */
  it("clamps a region that a capped canvas does not reach", () => {
    const cropped = canvasCropRect({ left: 250, top: 40, width: 200, height: 100 }, 3, 900, 1200);
    // 750..1350 wanted, 900 available: the right half of the region is gone,
    // and what survives is a picture rather than a transparent rectangle.
    expect(cropped).toEqual({ left: 750, top: 120, width: 150, height: 300 });
  });

  it("reports nothing at all rather than a transparent picture", () => {
    expect(canvasCropRect({ left: 400, top: 10, width: 100, height: 50 }, 3, 900, 1200)).toBeNull();
  });

  it("keeps a region that overhangs the bottom of the page, minus the overhang", () => {
    const cropped = canvasCropRect({ left: 10, top: 380, width: 100, height: 100 }, 2, 1200, 800);
    expect(cropped).toEqual({ left: 20, top: 760, width: 200, height: 40 });
  });

  it("refuses a scale that is not a positive number", () => {
    // A canvas that has not been laid out yet reports a client width of 0.
    expect(canvasCropRect(region, 0, 1200, 1600)).toBeNull();
    expect(canvasCropRect(region, Number.NaN, 1200, 1600)).toBeNull();
  });

  it("refuses a region with no area", () => {
    expect(canvasCropRect({ left: 10, top: 10, width: 0, height: 40 }, 2, 1200, 1600)).toBeNull();
  });
});
