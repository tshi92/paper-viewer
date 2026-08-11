export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length < 12) return "***";
  const prefix = key.startsWith("sk-") ? "sk-" : key.slice(0, 3);
  return `${prefix}***${key.slice(-4)}`;
}
