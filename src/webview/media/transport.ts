// Browser-owned File/Blob objects go straight to HTTP. No FileReader,
// arrayBuffer, base64, bytes in postMessage, or provider credential exists here.
import * as z from 'zod/mini'
import { HTTP_STATUS, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { companionMediaUploadSchema } from '../../shared/media'

export interface MediaUploadPort {
  readonly upload: (
    file: Blob,
    name: string,
    isScreenRecording: boolean,
    signal: AbortSignal,
    progress: (uploadedBytes: number, totalBytes: number) => void,
  ) => Promise<z.infer<typeof companionMediaUploadSchema>>
}

export interface CompanionUploadCredentials {
  readonly endpoint: string
  readonly origin: string
  readonly bearer: string
  readonly customHeader: { readonly name: string; readonly value: string }
  readonly metadataHeader: string
}

const failureSchema = z.strictObject({ reason: z.string() })

/** M104 C supplies its current per-window bearer after the one-use launch exchange. */
export function companionMediaTransport(
  credentials: () => CompanionUploadCredentials,
  newRequest: () => XMLHttpRequest = () => new XMLHttpRequest(),
): MediaUploadPort {
  return {
    upload: (file, name, isScreenRecording, signal, progress) =>
      new Promise((resolve, reject) => {
        signal.throwIfAborted()
        const access = credentials()
        const endpoint = new URL(access.endpoint)
        if (
          endpoint.origin !== access.origin ||
          endpoint.protocol !== 'http:' ||
          !['127.0.0.1', '[::1]'].includes(endpoint.hostname) ||
          endpoint.username !== '' ||
          endpoint.password !== '' ||
          access.bearer.length === 0
        )
          throw new Error(UI_TEXT.attachmentUnreadable)
        const requestId = crypto.randomUUID()
        const xhr = newRequest()
        const abort = () => {
          xhr.abort()
        }
        const cleanup = () => {
          signal.removeEventListener('abort', abort)
        }
        xhr.open('POST', endpoint.href)
        xhr.withCredentials = false
        xhr.responseType = 'json'
        xhr.setRequestHeader('Authorization', `Bearer ${access.bearer}`)
        xhr.setRequestHeader(access.customHeader.name, access.customHeader.value)
        xhr.setRequestHeader(
          access.metadataHeader,
          JSON.stringify({ requestId, name, isScreenRecording }),
        )
        xhr.setRequestHeader('Content-Type', 'application/octet-stream')
        xhr.upload.addEventListener('progress', (event) => {
          progress(Math.min(file.size, event.loaded), file.size)
        })
        xhr.addEventListener('load', () => {
          cleanup()
          if (signal.aborted) {
            reject(new Error(UI_TEXT.media.uploadStop))
            return
          }
          const body: unknown = xhr.response
          const parsed = companionMediaUploadSchema.safeParse(body)
          if (
            xhr.status !== HTTP_STATUS.ok ||
            xhr.responseURL !== endpoint.href ||
            !parsed.success ||
            parsed.data.requestId !== requestId ||
            parsed.data.name !== name ||
            parsed.data.info.sizeBytes !== file.size
          ) {
            const failure = failureSchema.safeParse(body)
            reject(
              new Error(
                failure.success
                  ? fill(UI_TEXT.media.uploadFailed, { reason: failure.data.reason })
                  : UI_TEXT.attachmentUnreadable,
              ),
            )
            return
          }
          progress(file.size, file.size)
          resolve(parsed.data)
        })
        xhr.addEventListener('error', () => {
          cleanup()
          reject(new Error(UI_TEXT.attachmentUnreadable))
        })
        xhr.addEventListener('abort', () => {
          cleanup()
          reject(new Error(UI_TEXT.media.uploadStop))
        })
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) {
          cleanup()
          reject(new Error(UI_TEXT.media.uploadStop))
          return
        }
        xhr.send(file)
      }),
  }
}
