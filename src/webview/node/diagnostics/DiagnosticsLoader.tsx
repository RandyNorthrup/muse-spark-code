import { useCallback, useEffect, useState } from 'react'
import { UI_TEXT } from '../../../shared/constants'
import type { NodeMethodPort, NodeMethodResult } from '../../../shared/hostApi/nodeMethods'
import { DiagnosticsPage } from '../../diagnostics/DiagnosticsPage'
import { RefreshButton } from '../RefreshButton'

type Diagnostics = NodeMethodResult<'node/diagnostics/read'>

// The node web UI's diagnostics surface: this loader owns the one
// `node/diagnostics/read` snapshot (a refresh re-reads it) and the shared
// Diagnostics page renders it. Failures reach the workspace's alert
// through the request runner, like every other node page.
export function DiagnosticsLoader({
  port,
  run,
  busy,
}: {
  readonly port: NodeMethodPort
  readonly run: (work: (signal: AbortSignal) => Promise<void>) => void
  readonly busy: boolean
}) {
  const [page, setPage] = useState<Diagnostics>()
  const refresh = useCallback(
    async (signal: AbortSignal) => {
      const current = await port.request('node/diagnostics/read', {}, signal)
      if (signal.aborted) return
      setPage(current)
    },
    [port],
  )
  useEffect(() => {
    run(refresh)
  }, [refresh, run])
  // No heading here: the shared page carries its own title, and a
  // second one would read twice.
  return (
    <section aria-label={UI_TEXT.nodeLabels.diagnostics}>
      <div className="node-actions">
        <RefreshButton
          busy={busy}
          onClick={() => {
            run(refresh)
          }}
        />
      </div>
      {page !== undefined && <DiagnosticsPage page={page} />}
    </section>
  )
}
