// Browser-owned File/Blob objects go straight to HTTP. No FileReader,
// arrayBuffer, base64 file bytes, postMessage bytes, or provider credential exists here.
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
  sendRequest: typeof fetch = (input, init) => fetch(input, init),
): MediaUploadPort {
  return {
    upload: async (file, name, isScreenRecording, signal, progress) => {
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
      // Fetch omits even same-origin cookies. Its Blob body has no native byte-progress events.
      progress(0, file.size)
      let response: Response
      let body: unknown
      try {
        response = await sendRequest(endpoint.href, {
          method: 'POST',
          mode: 'cors',
          credentials: 'omit',
          redirect: 'error',
          signal,
          headers: {
            Authorization: `Bearer ${access.bearer}`,
            [access.customHeader.name]: access.customHeader.value,
            // Encode only JSON metadata: headers require ASCII-safe strings; file bytes stay raw.
            [access.metadataHeader]: encodeURIComponent(
              JSON.stringify({ requestId, name, isScreenRecording }),
            ),
            'Content-Type': 'application/octet-stream',
          },
          body: file,
        })
        body = await response.json()
      } catch {
        throw new Error(signal.aborted ? UI_TEXT.media.uploadStop : UI_TEXT.attachmentUnreadable)
      }
      if (signal.aborted) throw new Error(UI_TEXT.media.uploadStop)
      const parsed = companionMediaUploadSchema.safeParse(body)
      if (
        response.status !== HTTP_STATUS.ok ||
        response.url !== endpoint.href ||
        !parsed.success ||
        parsed.data.requestId !== requestId ||
        parsed.data.name !== name ||
        parsed.data.info.sizeBytes !== file.size
      ) {
        const failure = failureSchema.safeParse(body)
        throw new Error(
          failure.success
            ? fill(UI_TEXT.media.uploadFailed, { reason: failure.data.reason })
            : UI_TEXT.attachmentUnreadable,
        )
      }
      progress(file.size, file.size)
      return parsed.data
    },
  }
}
