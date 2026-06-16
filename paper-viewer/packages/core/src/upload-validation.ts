type UploadInput = {
  fileName: string;
  contentType: string;
  byteLength: number;
  maxBytes: number;
};

type UploadValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
    };

export function validatePdfUpload(input: UploadInput): UploadValidationResult {
  const lowerName = input.fileName.toLowerCase();
  if (!lowerName.endsWith(".pdf") || input.contentType !== "application/pdf") {
    return { ok: false, reason: "Only PDF files are supported." };
  }

  if (input.byteLength > input.maxBytes) {
    return { ok: false, reason: "PDF exceeds the configured size limit." };
  }

  return { ok: true };
}
