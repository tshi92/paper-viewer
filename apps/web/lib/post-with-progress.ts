/**
 * POST a body and report how much of it has left the browser. `fetch` cannot
 * observe upload progress, so this goes through XMLHttpRequest and hands back
 * a standard Response for the caller to read as usual. Rejects when the
 * request never completes (network failure).
 */
export function postWithProgress(
  url: string,
  body: XMLHttpRequestBodyInit,
  onSentBytes: (sentBytes: number) => void,
  headers: Record<string, string> = {}
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => onSentBytes(event.loaded);
    xhr.onload = () => resolve(new Response(xhr.responseText, { status: xhr.status }));
    xhr.onerror = () => reject(new Error("Upload request failed"));
    xhr.onabort = () => reject(new Error("Upload request aborted"));
    xhr.send(body);
  });
}
