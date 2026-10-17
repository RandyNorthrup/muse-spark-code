import { useEffect, useState } from 'react'
import * as z from 'zod/mini'
import { MODEL_API_BASE_URL, UI_TEXT } from '../../shared/constants'

// The host validates the full captured envelope; revalidate only the two
// captured fields this row consumes without carrying the transport schemas.
const serviceStatusRowSchema = z.object({ service_status: z.string(), service_message: z.string() })

export type ServiceStatusReader = (signal: AbortSignal) => Promise<unknown>

/** The host supplies the public read through its validated bridge; the webview holds no key. */
export function ServiceStatusRow({
  read,
  onOpenExternal,
}: {
  readonly read: ServiceStatusReader
  readonly onOpenExternal: (url: string) => void
}) {
  const [answer, setAnswer] = useState<{
    readonly reader: ServiceStatusReader
    readonly status: z.infer<typeof serviceStatusRowSchema> | undefined
  }>()
  useEffect(() => {
    const stop = new AbortController()
    async function readStatus(): Promise<void> {
      try {
        const value = await read(stop.signal)
        const parsed = serviceStatusRowSchema.safeParse(value)
        if (!stop.signal.aborted)
          setAnswer({ reader: read, status: parsed.success ? parsed.data : undefined })
      } catch {
        if (!stop.signal.aborted) setAnswer({ reader: read, status: undefined })
      }
    }
    void readStatus()
    return () => {
      stop.abort()
    }
  }, [read])
  const status = answer?.reader === read ? answer.status : undefined
  const hasAnswered = answer?.reader === read
  return (
    <div className="usage-row">
      <div className="usage-row-head">
        <span>{UI_TEXT.modelApiStatusLabel}</span>
        <span role="status">
          {status?.service_status ??
            (hasAnswered ? UI_TEXT.modelApiStatusUnavailable : UI_TEXT.usageLoading)}
        </span>
      </div>
      {status?.service_message ? <p className="usage-row-meta">{status.service_message}</p> : null}
      <button
        type="button"
        className="usage-link"
        onClick={() => {
          onOpenExternal(`${MODEL_API_BASE_URL}/status`)
        }}
      >
        {UI_TEXT.modelApiStatusOpen}
      </button>
    </div>
  )
}
