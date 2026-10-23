// The node's nodes page (M110c lane U3, D90.12): every worker the
// orchestrator host knows, with its capabilities and liveness. Pure: the
// node server supplies the rows, and mounting waits on lane N.
import { UI_TEXT } from '../../../shared/constants'

export interface NodeListRow {
  readonly nodeId: string
  readonly capabilities: readonly string[]
  readonly liveness: 'live' | 'quiet' | 'gone'
}

export function NodeNodesPage({ nodes }: { readonly nodes: readonly NodeListRow[] }) {
  const livenessWord = {
    live: UI_TEXT.nodeTeam.live,
    quiet: UI_TEXT.nodeTeam.quiet,
    gone: UI_TEXT.nodeTeam.gone,
  }
  return (
    <section aria-label={UI_TEXT.reportLabels.nodes}>
      <h2>{UI_TEXT.reportLabels.nodes}</h2>
      {nodes.length === 0 ? (
        <p>{UI_TEXT.nodeTeam.noNodes}</p>
      ) : (
        <ul>
          {nodes.map((node) => {
            const detail =
              node.capabilities.length === 0
                ? ''
                : ` · ${UI_TEXT.nodeTeam.capabilities}: ${node.capabilities.join(', ')}`
            return (
              <li
                key={node.nodeId}
              >{`${node.nodeId} · ${livenessWord[node.liveness]}${detail}`}</li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
