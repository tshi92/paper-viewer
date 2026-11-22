/**
 * How a large PDF is cut up for upload. Vercel rejects any request body over
 * 4.5 MB before the function runs (413 FUNCTION_PAYLOAD_TOO_LARGE), so the
 * browser sends the file as parts that each fit, and the server joins them
 * (lib/upload-parts.ts). Pure and free of server imports: the upload form
 * imports this too.
 */
export const UPLOAD_PART_BYTES = 4 * 1024 * 1024;

const PART_ROOT = "uploads/";
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PartRange = { start: number; end: number };

export function partRanges(totalBytes: number): PartRange[] {
  const count = Math.ceil(totalBytes / UPLOAD_PART_BYTES);
  return Array.from({ length: count }, (_, index) => ({
    start: index * UPLOAD_PART_BYTES,
    end: Math.min((index + 1) * UPLOAD_PART_BYTES, totalBytes)
  }));
}

/** The id ends up in a storage path, so nothing but a UUID is accepted. */
export function isUploadId(value: string): boolean {
  return UPLOAD_ID.test(value);
}

export function allPartsPrefix(): string {
  return PART_ROOT;
}

/** Parts sit under the uploading user's id, so one user can never assemble another's upload. */
export function partPrefix(userId: string, uploadId: string): string {
  return `${PART_ROOT}${userId}/${uploadId}/`;
}

export function partPathname(userId: string, uploadId: string, index: number): string {
  return `${partPrefix(userId, uploadId)}${String(index).padStart(4, "0")}`;
}

export function partIndex(pathname: string): number | null {
  const match = /\/(\d{4})$/.exec(pathname);
  return match ? Number(match[1]) : null;
}
