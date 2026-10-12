// The caller supplies only a host-approved local resource. An MSP video-content
// decoder cannot be bound until the lead supplies its captured shape.
import { useEffect, useState } from 'react'
import { UI_TEXT } from '../../shared/constants'
import './media.css'

interface VideoResourcePort {
  readonly resolve: (path: string, signal: AbortSignal) => Promise<string>
  readonly isAllowed: (url: string) => boolean
}

export default function ToolVideo({
  path,
  resources,
}: {
  readonly path: string
  readonly resources: VideoResourcePort
}) {
  const [result, setResult] = useState<{
    readonly path: string
    readonly url?: string
    readonly hasFailed: boolean
  }>()
  useEffect(() => {
    const controller = new AbortController()
    void resources
      .resolve(path, controller.signal)
      .then((resolved) => {
        if (controller.signal.aborted) return
        if (!resources.isAllowed(resolved)) {
          setResult({ path, hasFailed: true })
          return
        }
        setResult({ path, url: resolved, hasFailed: false })
      })
      .catch((error: unknown) => {
        // A cancelled resolve stays silent (an abort throws past Error): an
        // unresolvable clip reads failed, and only a non-error keeps its
        // kind past the row.
        if (controller.signal.aborted) return
        if (!(error instanceof Error)) throw error
        setResult({ path, hasFailed: true })
      })
    return () => {
      controller.abort()
    }
  }, [path, resources])
  if (result?.path !== path) return <p role="status">{UI_TEXT.loadingOutput}</p>
  if (result.hasFailed) return <p role="status">{UI_TEXT.attachmentUnreadable}</p>
  return result.url === undefined ? (
    <p role="status">{UI_TEXT.loadingOutput}</p>
  ) : (
    <video
      className="companion-tool-video"
      src={result.url}
      controls
      preload="metadata"
      aria-label={path}
    />
  )
}
