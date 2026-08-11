export function maskWebhookUrl(url: string): string {
  if (!url) return "";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  const segments = parsed.pathname.split("/");
  const last = segments.pop() ?? "";
  const masked = last.length >= 8 ? `***${last.slice(-4)}` : "***";
  return `${parsed.origin}${segments.join("/")}/${masked}`;
}
