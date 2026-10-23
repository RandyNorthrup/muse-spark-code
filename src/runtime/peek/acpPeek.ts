// `/peek` over the agent's own tap (M110b K, PLAN.md D90.22): where the
// read-only page lands, `/peek <agent-id>` prints its link; until then,
// in a process with no page, it prints the agent's recent stream
// instead — the same versioned events as JSONL, scrubbed by the tap —
// and bare `/peek` names the agents. Unknown agents and empty taps say
// so in words; a locked vault refuses through the tap with the vault's
// own words, never unscrubbed events.
import type { PeekTap } from '../../core/peek/tap'
import { PEEK_DEFAULT_TAIL_EVENTS, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'

/** `/peek` takes at most the agent's id; anything more is invalid. */
export function parsePeekCommand(
  text: string,
): 'invalid' | { readonly agentId?: string } | undefined {
  const [name, agentId, ...rest] = text.trim().split(/\s+/u)
  if (name !== '/peek') return undefined
  if (rest.length > 0) return 'invalid'
  return agentId === undefined ? {} : { agentId }
}

/** List the tap's agents, or print one agent's recent stream as JSONL. */
export async function runPeekText(
  tap: PeekTap,
  args: { readonly agentId?: string },
): Promise<string> {
  if (args.agentId === undefined) {
    const streams = tap.list()
    return streams.length === 0
      ? UI_TEXT.peekNoAgents
      : streams
          .map((stream) =>
            stream.label === stream.streamId
              ? stream.streamId
              : `${stream.streamId} — ${stream.label}`,
          )
          .join('\n')
  }
  const tailed = await tap.tail(args.agentId, PEEK_DEFAULT_TAIL_EVENTS)
  return tailed === undefined
    ? fill(UI_TEXT.peekUnknownAgent, { id: args.agentId })
    : tailed.map((entry) => JSON.stringify(entry)).join('\n')
}
