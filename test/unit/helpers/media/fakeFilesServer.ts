// U6 transport behavior from the 2026-10-05 capture summary. Response bodies
// are injected: only the lead's scrubbed raw frames can decide their schema.
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import { once } from 'node:events'

export interface FakeFilesUpload {
  readonly name: string
  readonly mime: string
  readonly bytes: Uint8Array
  readonly expirySeconds: number
}

export interface FakeFilesFrames {
  readonly upload: (file: FakeFilesUpload) => unknown
  readonly retrieve: (id: string) => unknown
  readonly list: () => unknown
  readonly delete: (id: string) => unknown
  readonly content: (id: string) => Uint8Array | undefined
}

/** No auth fixture or real key is needed; only loopback traffic is accepted. */
export async function fakeFilesServer(frames: FakeFilesFrames) {
  const uploads: FakeFilesUpload[] = []
  const deletedIds: string[] = []
  const receivedChunkSizes: number[] = []
  const server = createServer((request, response) => {
    const handle = async () => {
      const route = new URL(request.url ?? '/', 'http://127.0.0.1')
      response.setHeader('content-type', 'application/json')
      if (request.method === 'POST' && route.pathname === '/v1/files') {
        const chunks: Uint8Array[] = []
        for await (const chunk of request) {
          if (!(chunk instanceof Uint8Array)) throw new Error('Expected upload bytes')
          receivedChunkSizes.push(chunk.byteLength)
          chunks.push(chunk)
        }
        const multipart = await new Response(Buffer.concat(chunks), {
          headers: { 'content-type': request.headers['content-type'] ?? '' },
        }).formData()
        const file = multipart.get('file')
        const expirySeconds = Number(multipart.get('expires_after[seconds]'))
        if (
          !(file instanceof File) ||
          multipart.get('purpose') !== 'user_data' ||
          multipart.get('expires_after[anchor]') !== 'created_at' ||
          !Number.isSafeInteger(expirySeconds) ||
          expirySeconds < 3600 ||
          expirySeconds > 2_592_000
        ) {
          response.writeHead(400).end(JSON.stringify({ error: 'Invalid U6 multipart fields' }))
          return
        }
        const upload = {
          name: file.name,
          mime: file.type,
          bytes: new Uint8Array(await file.arrayBuffer()),
          expirySeconds,
        }
        uploads.push(upload)
        response.end(JSON.stringify(frames.upload(upload)))
        return
      }
      if (request.method === 'GET' && route.pathname === '/v1/files') {
        response.end(JSON.stringify(frames.list()))
        return
      }
      const contentId = /^\/v1\/files\/([^/]+)\/content$/u.exec(route.pathname)?.[1]
      if (contentId !== undefined && request.method === 'GET') {
        const bytes = frames.content(decodeURIComponent(contentId))
        if (bytes === undefined) {
          response.writeHead(404).end()
        } else {
          response.setHeader('content-type', 'application/octet-stream')
          response.end(bytes)
        }
        return
      }
      const id = /^\/v1\/files\/([^/]+)$/u.exec(route.pathname)?.[1]
      if (id !== undefined && request.method === 'GET') {
        response.end(JSON.stringify(frames.retrieve(decodeURIComponent(id))))
        return
      }
      if (id !== undefined && request.method === 'DELETE') {
        const decoded = decodeURIComponent(id)
        deletedIds.push(decoded)
        response.end(JSON.stringify(frames.delete(decoded)))
        return
      }
      response.writeHead(404).end(JSON.stringify({ error: 'Unknown fake Files route' }))
    }
    void handle().catch((error: unknown) => {
      response
        .writeHead(500)
        .end(
          JSON.stringify({ error: error instanceof Error ? error.message : 'Fake Files failure' }),
        )
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('No fake Files port')
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}/v1`,
    uploads,
    deletedIds,
    receivedChunkSizes,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
        server.closeAllConnections()
      }),
  }
}
