// U6 Files egress for M105 headless existing-media delivery. Kept in the
// first-use runtime-media bundle so headless startup retains its fixed cap.
import {
  BYTES_PER_MIB,
  EXEC_ENDPOINTS,
  EXEC_FILES_BODY_HEADROOM_BYTES,
  MEDIA_MAX_UPLOAD_DEFAULT_MIB,
} from '../../shared/constants'

export async function forwardExecFile(
  parsed: URL,
  init: RequestInit | undefined,
  deps: {
    readonly forward: (url: string, init?: RequestInit) => Promise<Response>
    readonly refuse: () => never
    readonly signal: AbortSignal
  },
): Promise<Response> {
  const method = init?.method ?? 'GET'
  const isFilesRoot = parsed.pathname === EXEC_ENDPOINTS.files
  const isFile = /^\/v1\/files\/file-[A-Za-z0-9_-]+$/u.test(parsed.pathname)

  const after = parsed.searchParams.get('after')
  const isPage =
    parsed.search === '' ||
    (method === 'GET' &&
      isFilesRoot &&
      parsed.searchParams.size === 1 &&
      after !== null &&
      /^file-[A-Za-z0-9_-]+$/u.test(after))
  const isRead =
    (method === 'GET' || (method === 'DELETE' && isFile)) && init?.body == null && isPage
  if (isRead) return await deps.forward(parsed.href, init)
  const contentType = new Headers(init?.headers).get('content-type')
  const body = init?.body
  if (
    method !== 'POST' ||
    !isFilesRoot ||
    parsed.search !== '' ||
    !(body instanceof ReadableStream) ||
    !/^multipart\/form-data; boundary=[A-Za-z0-9-]+$/u.test(contentType ?? '')
  )
    return deps.refuse()
  let bytes = 0
  const bounded = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (!(chunk instanceof Uint8Array)) return deps.refuse()
        bytes += chunk.byteLength
        if (bytes > MEDIA_MAX_UPLOAD_DEFAULT_MIB * BYTES_PER_MIB + EXEC_FILES_BODY_HEADROOM_BYTES)
          return deps.refuse()
        deps.signal.throwIfAborted()
        controller.enqueue(chunk)
      },
    }),
  )
  return await deps.forward(parsed.href, { ...init, body: bounded })
}
