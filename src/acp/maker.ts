// The exact-payload approval in the ACP agent (RLF-DEVICES, D83.3): the
// same question the Devices panel asks, as the editor's permission
// prompt. Every payload asks; there is no "always", and a cancel, an
// unanswered wait or an option the prompt did not offer is Reject, so
// nothing is sent by a translation default (D62).
import type { PermissionOption, RequestPermissionResponse } from '@agentclientprotocol/sdk'
import { failureForLog } from '../core/backends/musecode/logText'
import type { MakerApprovalAsker } from '../core/maker/approval'
import type { CoreLogger } from '../core/logging'
import { MAKER_PERMISSION_OPTIONS, UI_TEXT } from '../shared/constants'
import { fill, formatDateTime, formatList, formatNumber } from '../shared/l10n/text'
import type { MakerApprovalAnswer, MakerApprovalPrompt } from '../shared/maker'
import { makerBoundsParts, makerKindText, makerOperationText } from '../shared/makerText'

/** The question in one of the client's sessions; the agent attaches it (agent.ts). */
export type MakerUseAsker = (
  sessionId: string,
  prompt: MakerApprovalPrompt,
  signal: AbortSignal,
) => Promise<MakerApprovalAnswer | null>

export interface AcpMakerSurfaceDeps {
  readonly log: CoreLogger
}

export class AcpMakerSurface {
  private asker: MakerUseAsker | undefined
  public constructor(private readonly deps: AcpMakerSurfaceDeps) {}

  /** The agent's way to ask; until it is attached, every send is refused. */
  public attach(asker: MakerUseAsker): void {
    this.asker = asker
  }

  /** The engine's asker port for one session's maker runs. */
  public askerFor(sessionId: string): MakerApprovalAsker {
    return async (prompt, signal) => {
      const asker = this.asker
      if (asker === undefined) {
        this.deps.log.warn(
          `Maker send on ${prompt.target.name}: no editor session to ask in, so it is refused`,
        )
        return null
      }
      try {
        return await asker(sessionId, prompt, signal)
      } catch (error: unknown) {
        this.deps.log.warn(
          `Maker send on ${prompt.target.name}: the editor could not be asked, so it is refused: ${failureForLog(error)}`,
        )
        return null
      }
    }
  }
}

/** The prompt's options: this payload only, or reject. */
export function makerPermissionOptions(): PermissionOption[] {
  return [
    {
      optionId: MAKER_PERMISSION_OPTIONS.allowOnce,
      name: UI_TEXT.devices.makerSendOnce,
      kind: 'allow_once',
    },
    {
      optionId: MAKER_PERMISSION_OPTIONS.deny,
      name: UI_TEXT.devices.makerReject,
      kind: 'reject_once',
    },
  ]
}

/** The tool call row: the operation on the machine's name. */
export function makerPermissionTitle(prompt: MakerApprovalPrompt): string {
  return `${makerOperationText(prompt.operation)} · ${prompt.target.name}`
}

/**
The question's body: the target, the operation, the warning, the
analysis and the exact payload lines with their digest. It renders
every preview line, however many: the person approves the exact
bytes (D83.3), and D121 keeps no count of ours.
*/
export function makerPermissionDetail(prompt: MakerApprovalPrompt): string {
  const lines: string[] = []
  const { target, analysis } = prompt
  lines.push(
    `${UI_TEXT.devices.makerTarget}: ${[makerKindText(target.kind), target.name, target.endpoint, ...(target.reportedAs === undefined ? [] : [target.reportedAs])].join(' · ')}`,
    `${UI_TEXT.devices.makerOperation}: ${makerOperationText(prompt.operation)}`,
  )
  if (target.simulated) lines.push(UI_TEXT.devices.makerSimulator, UI_TEXT.devices.makerSimNote)
  if (prompt.warning === 'portReset') lines.push(UI_TEXT.devices.makerWarningPortReset)
  if (analysis !== undefined) {
    lines.push(`${UI_TEXT.devices.makerAnalysis}:`)
    if (analysis.maxTempC !== undefined)
      lines.push(`${UI_TEXT.devices.makerMaxTemp}: ${formatNumber(analysis.maxTempC)} °C`)
    if (analysis.maxFeedMmMin !== undefined)
      lines.push(`${UI_TEXT.devices.makerMaxFeed}: ${formatNumber(analysis.maxFeedMmMin)} mm/min`)
    if (analysis.bounds !== undefined) {
      const ranges = makerBoundsParts(analysis.bounds)
      if (ranges.length > 0) lines.push(`${UI_TEXT.devices.makerBounds}: ${ranges.join(' · ')}`)
    }
    if (analysis.unknownCommands.length > 0)
      lines.push(`${UI_TEXT.devices.makerUnknownCommands}: ${formatList(analysis.unknownCommands)}`)
  }
  lines.push(`${UI_TEXT.devices.makerPayload}:`)
  if (prompt.preview.length === 0) lines.push(UI_TEXT.devices.makerPayloadEmpty)
  for (const line of prompt.preview) lines.push(line.kind === 'text' ? line.text : line.hex)
  lines.push(`${UI_TEXT.devices.makerDigest}: ${prompt.digest}`)
  if (prompt.expiresAt !== undefined)
    lines.push(fill(UI_TEXT.devices.makerExpires, { expiry: formatDateTime(prompt.expiresAt) }))
  lines.push(UI_TEXT.devices.makerApprovalClosed)
  return lines.join('\n')
}

/**
The client's answer. A cancel, or an option the prompt did not offer,
is Reject: nothing is sent by a translation default (D62).
*/
export function makerPermissionAnswer(response: RequestPermissionResponse): 'send' | 'reject' {
  const { outcome } = response
  return outcome.outcome === 'selected' && outcome.optionId === MAKER_PERMISSION_OPTIONS.allowOnce
    ? 'send'
    : 'reject'
}
