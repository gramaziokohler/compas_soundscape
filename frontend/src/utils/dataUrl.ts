/**
 * Data-URI helpers — stateless conversions between Blobs, URLs and base64
 * data URIs (the format the LLM endpoints accept for images).
 */

/** Read a Blob / File as a base64 data URI. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Blob of a data URI (or any fetchable URL). */
export async function urlToBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
  return res.blob();
}

/** Data URI of a fetchable URL (e.g. a saved image served by the backend). */
export async function urlToDataUrl(url: string): Promise<string> {
  return blobToDataUrl(await urlToBlob(url));
}
