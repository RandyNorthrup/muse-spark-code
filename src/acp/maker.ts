import type {
  AgentContext,
  PermissionOption,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk'
import type { ApprovalRequest, ApprovalAnswer } from '../shared/makerProtocol'
import { makerApprovalRequestSchema } from '../shared/makerProtocol'
import { UI_TEXT } from '../shared/constants'
import type { McpTool } from '../core/mcp'
import type { SessionMcpServer } from '../core/agent/agentBackend'

export interface AcpMakerSession {
  readonly server: SessionMcpServer
  setInteractive(isEligible: boolean): void
  command(text: string): Promise<string | undefined>
  cancel(): Promise<void>
  close(): Promise<void>
}
export interface AcpMakerRuntime {
  session(
    cwd: string,
    ask: (request: ApprovalRequest) => Promise<unknown>,
  ): Promise<AcpMakerSession>
  toolsFor(cwd: string): readonly McpTool[]
  close(): Promise<void>
}
export function acpMakerAsker(client: AgentContext, sessionId: () => string) {
  return (request: ApprovalRequest) =>
    askMakerPermission(request, (title, text, options) =>
      client.request('session/request_permission', {
        sessionId: sessionId(),
        toolCall: {
          toolCallId: request.id,
          title,
          kind: 'other',
          status: 'pending',
          content: [{ type: 'content', content: { type: 'text', text } }],
        },
        options,
      }),
    )
}

export function makerPermissionOptions(): PermissionOption[] {
  return [
    { optionId: 'allow_once', kind: 'allow_once', name: UI_TEXT.makerSendOnce },
    { optionId: 'reject_once', kind: 'reject_once', name: UI_TEXT.makerReject },
  ]
}
/** The editor receives the whole target/payload; only its offered choice answers it. */
export async function askMakerPermission(
  request: ApprovalRequest,
  ask: (
    title: string,
    text: string,
    options: PermissionOption[],
  ) => Promise<RequestPermissionResponse>,
): Promise<ApprovalAnswer> {
  const snapshot = makerApprovalRequestSchema.parse(request)
  let decision: ApprovalAnswer['decision'] = 'reject_once'
  // A closed/disconnected editor rejects this use.
  const [attempt] = await Promise.allSettled([
    ask(UI_TEXT.makerApprovalTitle, JSON.stringify(snapshot, null, 2), makerPermissionOptions()),
  ])
  if (
    attempt.status === 'fulfilled' &&
    attempt.value.outcome.outcome === 'selected' &&
    attempt.value.outcome.optionId === 'allow_once'
  )
    decision = 'allow_once'
  return { id: snapshot.id, digest: snapshot.digest, target: snapshot.target, decision }
}

/** Shared command recognition, including Stop while a turn is busy. */
export function parseMakerSlashCommand(text: string) {
  const match = /^\/(hardware|machines|stop-machine)(?:\s+(.*))?$/.exec(text.trim())
  return match === null ? undefined : { name: match[1], args: match[2]?.trim() ?? '' }
}
