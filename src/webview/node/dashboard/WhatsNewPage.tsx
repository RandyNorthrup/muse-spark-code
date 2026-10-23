import { useCallback, useEffect, useState } from 'react'
import { UI_TEXT } from '../../../shared/constants'
import type { NodeMethodPort } from '../../../shared/hostApi/nodeMethods'

/** What this node release added, headed by the node's own version: the
version comes from the dashboard read, so the page never names a release
it does not run. */
export function WhatsNewPage({
  port,
  run,
  busy,
}: {
  readonly port: NodeMethodPort
  readonly run: (work: (signal: AbortSignal) => Promise<void>) => void
  readonly busy: boolean
}) {
  const [version, setVersion] = useState<string>()
  const refresh = useCallback(
    async (signal: AbortSignal) => {
      const current = await port.request('node/dashboard/read', {}, signal)
      if (signal.aborted) return
      setVersion(current.version)
    },
    [port],
  )
  useEffect(() => {
    run(refresh)
  }, [refresh, run])
  return (
    <section aria-label={UI_TEXT.nodeWhatsNew.title}>
      <h2>{UI_TEXT.nodeWhatsNew.title}</h2>
      {version !== undefined && (
        <p>
          {UI_TEXT.nodeLabels.version}: {version}
        </p>
      )}
      <ul>
        <li>{UI_TEXT.nodeWhatsNew.terminal}</li>
        <li>{UI_TEXT.nodeWhatsNew.dashboard}</li>
        <li>{UI_TEXT.nodeWhatsNew.audit}</li>
        <li>{UI_TEXT.nodeWhatsNew.sandbox}</li>
      </ul>
      <div className="node-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            run(refresh)
          }}
        >
          {UI_TEXT.nodeWorkspace.refresh}
        </button>
      </div>
    </section>
  )
}
