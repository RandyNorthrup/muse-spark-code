// The ACP agent's team port (M96b, RLF-ACPTEAM): what `serve --team`
// lends each session, over the same team core the panel binds. The
// implementation lives in dist/acpTeam.js (src/acp/acpTeamEntry.ts),
// loaded only when the agent starts with `--team`; this file is types
// and the refusal brand only, so the always-loaded agent carries none
// of the team itself.
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionUpdate,
} from '@agentclientprotocol/sdk/unstable'
import type { SessionMcpHttpServer } from '../core/agent/agentBackend'
import type { TeamHostSeams } from '../core/team/teamHostService'
import type { PermissionMode } from '../shared/constants'

/** What one held ACP session lends the team: its mode, its updates, its prompts. */
export interface AcpTeamSessionHandler {
  /** The session's permission mode, read when a card is shown. */
  readonly mode: () => PermissionMode
  /** Queues one `session/update` for this session, in order. */
  readonly sendUpdate: (update: SessionUpdate) => void
  /** The editor's `session/request_permission`, ended by the turn's stop. */
  readonly requestPermission: (
    request: RequestPermissionRequest,
  ) => Promise<RequestPermissionResponse>
}

/** One ACP session's team, from its attach until its close. */
export interface AcpTeamSession {
  /** This session runs as a team conversation (its tools are declared). */
  readonly isTeamOn: () => boolean
  /** The editor cancelled: every worker this session delegated stops. */
  readonly cancel: () => Promise<void>
  /** The session closed: its workers stop and its handler lets go. */
  readonly close: () => Promise<void>
}

/**
A session admitted for its team before its backend session exists: the
mode it runs in, the `team` MCP endpoint a Muse Code orchestrator
carries in its start, and the attach that binds the started session.
*/
export interface AcpTeamPrepared {
  /** The session runs as a team conversation. */
  readonly isTeam: boolean
  /** Why a stored team conversation resumed without its team, said in the session. */
  readonly notice?: string | undefined
  /** Muse Code orchestrators only: the `team` MCP server for the start. */
  readonly mcpServer?: SessionMcpHttpServer | undefined
  /** Binds the started session: records its mode and registers its handler. */
  readonly attach: (sessionId: string, handler: AcpTeamSessionHandler) => Promise<AcpTeamSession>
}

/**
The brand an admission refusal carries across the bundle boundary: its
message is one of the product's own sentences, safe to show the person
as the request's error. Anything else the team throws keeps the
agent's generic start-failure words.
*/
export const ACP_TEAM_REFUSAL_NAME = 'AcpTeamRefusal'

/** Whether this failure is a branded admission refusal. */
export function isAcpTeamRefusal(error: unknown): error is Error {
  return error instanceof Error && error.name === ACP_TEAM_REFUSAL_NAME
}

/** The `--team` agent's team, one binding per workspace folder. */
export interface AcpTeamPort {
  /**
  Admits a new session through `teamSessionAdmission` (D227): throws the
  refusal sentence when the workspace has no second usable model, so an
  explicit `--team` never runs on silently as single-model.
  */
  readonly prepareNew: (cwd: string, modelId: string) => Promise<AcpTeamPrepared>
  /**
  A loaded or resumed session: its stored mode decides. A team
  conversation whose team is no longer admissible resumes single-model
  with the reason as its notice, never locked out of its history.
  */
  readonly prepareResume: (
    cwd: string,
    sessionId: string,
    modelId: string,
  ) => Promise<AcpTeamPrepared>
  /** The Model API orchestrator's seams for one workspace folder. */
  readonly seamsFor: (cwd: string) => TeamHostSeams
  /** Stops every workspace's team (the agent is ending). */
  readonly dispose: () => Promise<void>
}
