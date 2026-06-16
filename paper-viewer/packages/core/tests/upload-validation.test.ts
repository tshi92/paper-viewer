import { describe, expect, it } from "vitest";
import { validatePdfUpload } from "../src/upload-validation";

describe("validatePdfUpload", () => {
  it("accepts PDF uploads under the configured size limit", () => {
    expect(
      validatePdfUpload({
        fileName: "paper.pdf",
        contentType: "application/pdf",
        byteLength: 1024,
        maxBytes: 10_000
      })
    ).toEqual({ ok: true });
  });

  it("rejects non-PDF files", () => {
    expect(
      validatePdfUpload({
        fileName: "paper.txt",
        contentType: "text/plain",
        byteLength: 1024,
        maxBytes: 10_000
      })
    ).toEqual({ ok: false, reason: "Only PDF files are supported." });
  });

  it("rejects oversized PDFs", () => {
    expect(
      validatePdfUpload({
        fileName: "paper.pdf",
        contentType: "application/pdf",
        byteLength: 20_000,
        maxBytes: 10_000
      })
    ).toEqual({ ok: false, reason: "PDF exceeds the configured size limit." });
  });
});
