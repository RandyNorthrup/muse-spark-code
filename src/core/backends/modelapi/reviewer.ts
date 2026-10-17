// The built-in Reviewer on the Model API backend (M70, PLAN.md D49): its own
// prompt, and the tools it may call, which only read. A `/review` the user
// asks for is a turn of the conversation run as the Reviewer; a child task
// whose role is `reviewer` is one too (paid, D45 and D48). M76 moves it into
// the Markdown agent format later; these rules come with it.

import {
  IDE_MCP_SERVER_NAME,
  IDE_MCP_TOOL_DIAGNOSTICS,
  MODEL_API_TOOLS,
  REVIEW_MODEL_TEXT,
  REVIEWER_ROLE,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { type EnvironmentFacts, rulesText } from './instructions'
import { mcpFunctionName } from './mcp/functions'

const PARAGRAPH = '\n\n'
const LIST_SEPARATOR = ', '

/**
 * Every tool the Reviewer may call. None writes, runs a command or reaches
 * the network: the workspace readers and VS Code's Problems panel. A tool
 * added to either list later is not the Reviewer's until it is named here.
 */
const REVIEWER_TOOL_NAMES: ReadonlySet<string> = new Set([
  MODEL_API_TOOLS.readFile,
  MODEL_API_TOOLS.search,
  MODEL_API_TOOLS.listFiles,
  mcpFunctionName(IDE_MCP_SERVER_NAME, IDE_MCP_TOOL_DIAGNOSTICS, new Set()),
])

/** Whether the Reviewer may call the tool of this function name. */
export function isReviewerTool(name: string): boolean {
  return REVIEWER_TOOL_NAMES.has(name)
}

/** What the model is told when it names a tool the Reviewer may not call. */
export function reviewerToolRefusal(name: string): string {
  return `${name} ${REVIEW_MODEL_TEXT.reviewerToolRefused}`
}

/** Whether a child task's role makes it the Reviewer. */
export function isReviewerRole(role: string): boolean {
  return role.trim().toLowerCase() === REVIEWER_ROLE
}

export interface ReviewerFacts {
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  /** The function names this request offers, in order. */
  readonly toolNames: readonly string[]
  /** `YYYY-MM-DD` in the host's clock. */
  readonly today: string
  readonly environment: EnvironmentFacts
  /** The workspace's rules files, trusted workspaces only (D13). */
  readonly rules: string | undefined
}

/** The Reviewer's system instructions: who it is, what it may do, how it reviews. */
export function reviewerInstructionsFor(facts: ReviewerFacts): string {
  const role = [
    REVIEW_MODEL_TEXT.reviewerRole,
    fill(REVIEW_MODEL_TEXT.reviewerWorkspace, {
      root: facts.workspaceRoot,
      platform: facts.platform,
    }),
    fill(REVIEW_MODEL_TEXT.reviewerTools, { tools: facts.toolNames.join(LIST_SEPARATOR) }),
    REVIEW_MODEL_TEXT.reviewerMaterial,
  ].join(PARAGRAPH)
  const sections = [
    role,
    fill(REVIEW_MODEL_TEXT.reviewerEnvironment, { today: facts.today }),
    REVIEW_MODEL_TEXT.reviewMethod,
    rulesText(facts.rules),
  ]
  return sections.filter((section) => section !== undefined).join(PARAGRAPH)
}
