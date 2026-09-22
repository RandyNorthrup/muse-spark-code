// Browser-side byte helpers for pasted and dropped images. The host receives
// base64 over postMessage and decodes it once into the attachment store.

// btoa works on binary strings; converting in slices keeps the spread below
// the engine's argument limit for multi-megabyte images.
const SLICE_BYTES = 0x80_00

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += SLICE_BYTES) {
    binary += String.fromCodePoint(...bytes.subarray(offset, offset + SLICE_BYTES))
  }
  return btoa(binary)
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()))
}

/** The URIs in a `text/uri-list` payload (comment lines start with `#`). */
export function parseUriList(text: string): readonly string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
}
