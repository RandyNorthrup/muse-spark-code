import { createHash } from 'node:crypto'

// A fake Meta Files API for media tests, answering the captured U6 wire:
// multipart `purpose=user_data` uploads with the bracket-form expiry,
// retrieve, list and delete, plus the round-3 404 `file_not_found` frame.
// Receipts echo the uploaded bytes, so the client's validation runs as it
// does against the service. Nothing here is a capture or a pricing claim.
export interface FakeUploadedFile {
  readonly fileId: string
  readonly name: string
  readonly mime: string
  readonly bytes: number
  readonly sha256: string
  readonly expirySeconds: number
  readonly createdAt: number
}

const CREATED_AT = 2_000_000_000

function fileReceipt(file: FakeUploadedFile) {
  return {
    id: file.fileId,
    object: 'file',
    bytes: file.bytes,
    created_at: file.createdAt,
    expires_at: file.createdAt + file.expirySeconds,
    filename: file.name,
    purpose: 'user_data',
    status: 'processed',
  }
}

function notFound(fileId: string): Response {
  return Response.json(
    {
      error: {
        code: 'file_not_found',
        message: `No file found with id '${fileId}'.`,
        param: null,
        type: 'invalid_request_error',
      },
    },
    { status: 404 },
  )
}

function parseMultipart(
  body: Buffer,
  contentType: string,
): {
  fields: Map<string, string>
  filename: string
  mime: string
  payload: Buffer
} {
  const boundary = /boundary=([^\s;]+)/u.exec(contentType)?.[1]
  if (boundary === undefined) throw new Error('Fake Files: missing boundary')
  const text = body.toString('latin1')
  const fields = new Map<string, string>()
  let filename = ''
  let mime = ''
  let payload: Buffer | undefined
  for (const chunk of text.split(`--${boundary}`)) {
    const headerEnd = chunk.indexOf('\r\n\r\n')
    if (headerEnd === -1) continue
    const header = chunk.slice(0, headerEnd)
    let value = chunk.slice(headerEnd + 4)
    if (value.endsWith('\r\n')) value = value.slice(0, -2)
    const name = /name="([^"]*)"/u.exec(header)?.[1]
    if (name === undefined) continue
    const file = /filename="([^"]*)"/u.exec(header)?.[1]
    if (file === undefined) {
      fields.set(name, value)
      continue
    }
    filename = file
    mime = /Content-Type: ([^\r]*)/u.exec(header)?.[1]?.trim() ?? ''
    payload = Buffer.from(value, 'latin1')
  }
  if (payload === undefined || filename === '') throw new Error('Fake Files: no file part')
  return { fields, filename, mime, payload }
}

export interface FakeFilesApi {
  /** Wraps a fetch: `/files` routes are answered here, the rest delegated. */
  readonly fetch: typeof fetch
  readonly uploads: FakeUploadedFile[]
  readonly deletes: string[]
  readonly retrieves: string[]
  readonly files: Map<string, FakeUploadedFile>
}

export function fakeFilesApi(delegate: typeof fetch): FakeFilesApi {
  const uploads: FakeUploadedFile[] = []
  const deletes: string[] = []
  const retrieves: string[] = []
  const files = new Map<string, FakeUploadedFile>()
  const api: FakeFilesApi = {
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      let href: string
      if (typeof input === 'string') href = input
      else if (input instanceof URL) href = input.href
      else href = input.url
      const url = new URL(href)
      const path = url.pathname.replace(/^\/v1/, '')
      if (!path.startsWith('/files')) return await delegate(input, init)
      const method = init?.method ?? 'GET'
      if (method === 'POST' && path === '/files') {
        const contentType =
          (init?.headers as Record<string, string> | undefined)?.['Content-Type'] ??
          (init?.headers as Record<string, string> | undefined)?.['content-type'] ??
          ''
        const chunks: Buffer[] = []
        const stream = init?.body as ReadableStream<Uint8Array> | undefined
        if (stream === undefined) throw new Error('Fake Files: upload without a body')
        for await (const chunk of stream) chunks.push(Buffer.from(chunk))
        const { fields, filename, mime, payload } = parseMultipart(
          Buffer.concat(chunks),
          contentType,
        )
        if (fields.get('purpose') !== 'user_data')
          return Response.json({ error: { message: 'bad purpose' } }, { status: 400 })
        const expirySeconds = Number(fields.get('expires_after[seconds]') ?? '0')
        if (!Number.isSafeInteger(expirySeconds) || expirySeconds <= 0)
          return Response.json({ error: { message: 'bad expiry' } }, { status: 400 })
        const createdAt = CREATED_AT + uploads.length
        const file: FakeUploadedFile = {
          fileId: `file-test-${String(uploads.length + 1)}`,
          name: filename,
          mime,
          bytes: payload.length,
          sha256: createHash('sha256').update(payload).digest('hex'),
          expirySeconds,
          createdAt,
        }
        uploads.push(file)
        files.set(file.fileId, file)
        return Response.json(fileReceipt(file))
      }
      const id = /^\/files\/(file-[A-Za-z0-9_-]+)$/u.exec(path)?.[1]
      if (id === undefined) {
        if (method === 'GET' && path === '/files')
          return Response.json({
            object: 'list',
            data: Array.from(files.values(), fileReceipt),
            has_more: false,
          })
        return Response.json({ error: { message: 'unknown files route' } }, { status: 404 })
      }
      if (method === 'GET') {
        retrieves.push(id)
        const file = files.get(id)
        return file === undefined ? notFound(id) : Response.json(fileReceipt(file))
      }
      if (method === 'DELETE') {
        deletes.push(id)
        if (!files.has(id)) return notFound(id)
        files.delete(id)
        return Response.json({ id, object: 'file', deleted: true })
      }
      return Response.json({ error: { message: 'unknown files method' } }, { status: 404 })
    },
    uploads,
    deletes,
    retrieves,
    files,
  }
  return api
}
