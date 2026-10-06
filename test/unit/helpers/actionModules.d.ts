// Types for the Action's Node-only .mjs modules (M80 lane C, SPEC §6.8), as
// the action tests import them. The modules ship without TypeScript; these
// declarations describe their exports for the tests' type checks only.

interface ActionPaths {
  invocation: string
  work: string
  out: string
  checkout: string
  action: string
  prompt: string
  diff: string
  diffFull: string
  meta: string
  gate: string
  inputs: string
  staging: string
  eventsTmp: string
  resultTmp: string
  manifestTmp: string
  events: string
  result: string
  patch: string
  manifest: string
  emptyGitConfig: string
  emptyHooks: string
  home: string
  tmp: string
  agent: string
  npmCache: string
  npmUserConfig: string
  npmGlobalConfig: string
  download: string
}

type ActionStop =
  | { kind: 'signal'; signal: 'SIGINT' | 'SIGTERM' }
  | { kind: 'phase_timeout'; phase: string }
  | { kind: 'output_limit' | 'failure' }

interface ActionChildOutcome {
  code: number | null
  signal: string | null
  stdout: Uint8Array
  stderr: Uint8Array
}

interface ActionChildInput {
  file: string
  args: readonly string[]
  cwd: string
  env: Record<string, string>
  stdin?: Uint8Array
  stdoutPath?: string
  withinMs: number
  stdoutMaxBytes: number
  stderrMaxBytes: number
}

interface LauncherOwner {
  readonly signal: AbortSignal
  readonly stopped: boolean
  readonly cause: ActionStop | null
  readonly publicationAllowed: boolean
  readonly cleanupFailed: boolean
  stop(cause: ActionStop): void
  phase<T>(
    name: string,
    withinMs: number,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T>
  child(input: ActionChildInput): Promise<ActionChildOutcome>
  cleanup(): Promise<void>
}

interface ActionBounds {
  killAfterMs: number
  reapMs: number
  cleanupMs: number
}

interface ActionInputs {
  mode: 'review' | 'fix'
  maxBudgetUsd: string
  imageGeneration: boolean
  maxRequests: number
  timeoutMinutes: number
  model: string
  effort: string
  allowContributorModels: boolean
  maxDiffBytes: number
  triggerPhrase: string
  prNumber: number | null
  extraInstructions: string
  path: string
  postComment: boolean
  uploadArtifacts: boolean
  httpsProxy: string
  noProxy: string
  extraCaCerts: string
  agentPackage: string
  agentPackageSha256: string
}

interface ActionNetwork {
  httpsProxy: string
  noProxy: string
  extraCaCerts: string
}

interface ActionResultLike {
  status: string
  exitCode: number
  finalMessage: string
  filesChanged: string[]
  model: string | null
  usage: {
    requests: number | null
    costUsd: {
      settled: string
      uncertain: string
      reserved: string
      total: string
      isUpperBound: boolean
    } | null
    paid: {
      imageAttempts: number
      imagesReturned: number
      imagesUncertain: number
      uncertainUsd: string
    }
  }
}

type ActionGateDecision =
  | { allowed: false; reason: string }
  | {
      allowed: true
      prNumber: number
      headSha: string
      baseSha: string
      headRef: string
      task: string
      title: string
      body: string
      warning: string | null
    }

interface ActionStaged {
  mode: 'review' | 'fix'
  task: string
  extraInstructions: string
  prNumber: number
  headSha: string
  baseSha: string
  metadataTruncated: boolean
  maxDiffBytes: number
}

interface ActionRunReport {
  execCode: number | null
  result: ActionResultLike | null
  wrapperFailed: boolean
  patchWithheld: string
  patchPublished: boolean
  diffTruncated: boolean
}

interface ActionRunInput {
  owner: LauncherOwner
  paths: ActionPaths
  inputs: ActionInputs
  key: string
  node: string
  git: string
  agentJs: string
  baseEnv: Record<string, string>
  templatesDir: string
  identity: { runId: string; attempt: string; invocation: string }
  log: (text: string) => void
}

declare module '*/action/lib/lifecycle.mjs' {
  export const ACTION_GATE_MS: number
  export const ACTION_INSTALL_MS: number
  export const ACTION_CHECKOUT_MS: number
  export const ACTION_INPUT_MS: number
  export const ACTION_EXEC_OVERHEAD_MS: number
  export const ACTION_GIT_MS: number
  export const ACTION_SCAN_MS: number
  export const ACTION_EXTRACT_MS: number
  export const ACTION_PUBLISH_MS: number
  export const ACTION_POST_MS: number
  export const ACTION_DOWNLOAD_MS: number
  export const ACTION_APPLY_MS: number
  export const ACTION_PUSH_MS: number
  export const ACTION_STOP_GRACE_MS: number
  export const ACTION_KILL_AFTER_MS: number
  export const ACTION_REAP_MS: number
  export const ACTION_CLEANUP_MS: number
  export const ACTION_STDERR_MAX_BYTES: number
  export const ACTION_CHILD_STDOUT_MAX_BYTES: number
  export const ACTION_EVENTS_MAX_BYTES: number
  export const ACTION_RESULT_MAX_BYTES: number
  export const ACTION_PATCH_MAX_BYTES: number
  export const ACTION_SCAN_STDOUT_MAX_BYTES: number
  export const ACTION_COMMENT_MAX_CHARS: number
  export const ACTION_META_MAX_BYTES: number
  export const ACTION_TASK_MAX_CHARS: number
  export const ACTION_DEFAULT_MAX_DIFF_BYTES: number
  export const ACTION_MAX_DIFF_BYTES: number
  export const ACTION_EVENT_MAX_BYTES: number
  export const ACTION_W_BUDGET_USD: number
  export const ACTION_KEY_MAX_BYTES: number
  export const DEFAULT_BOUNDS: Readonly<ActionBounds>
  export class ActionStopError extends Error {
    readonly stop: ActionStop
  }
  export function signalExitCode(signal: string): number
  export function outcomeCode(outcome: ActionChildOutcome): number
  export function redactLiterals(text: string, literals: readonly (string | undefined)[]): string
  export function childEnvironment(input: {
    platform: NodeJS.Platform
    parentEnv: Record<string, string | undefined>
    paths: Pick<ActionPaths, 'home' | 'tmp'>
    nodePath: string
    network?: ActionNetwork
  }): Record<string, string>
  export function createLauncherOwner(input: {
    paths: Partial<ActionPaths>
    dropSecrets: () => void
    totalMs: number
    bounds?: ActionBounds
    onSignal?: (signal: 'SIGINT' | 'SIGTERM', run: () => void) => () => void
    temporaryFiles?: readonly string[]
  }): LauncherOwner
}

declare module '*/action/lib/git.mjs' {
  export const GIT_METADATA_OPTIONS: readonly string[]
  export const INERT_CONFIG_NAMES: ReadonlySet<string>
  export function checkConfigNames(output: string): void
  export function remoteProtocol(remote: string): 'https' | 'file'
  export function safeGitOptions(paths: Pick<ActionPaths, 'emptyHooks'>): string[]
  export function subcommandOf(args: readonly string[]): string
  export function gitEnvironment(input: {
    baseEnv: Record<string, string | undefined>
    paths: Pick<ActionPaths, 'emptyGitConfig'>
    readOnly: boolean
    auth?: { kind: 'checkout' | 'push'; token: string }
    cwd?: string
    protocol?: 'https' | 'file'
  }): Record<string, string>
  export function safeGit(input: {
    owner: LauncherOwner
    git: string
    cwd: string
    args: readonly string[]
    paths: ActionPaths
    baseEnv: Record<string, string>
    readOnly: boolean
    stdoutPath?: string
    auth?: { kind: 'checkout' | 'push'; token: string }
    protocol?: 'https' | 'file'
    withinMs?: number
    stdoutMaxBytes?: number
  }): Promise<ActionChildOutcome>
  export function requireGit(outcome: ActionChildOutcome, what: string): ActionChildOutcome
  export function gitText(outcome: ActionChildOutcome): string
}

declare module '*/action/lib/tools.mjs' {
  export class InputError extends Error {}
  export function canonicalOutside(candidate: string, workspace: string, label: string): string
  export function regularFileOutside(candidate: string, workspace: string, label: string): string
  export function checkoutPathFor(workspace: string, relative: string): string
  export function findGit(input: {
    env: Record<string, string | undefined>
    platform: NodeJS.Platform
    workspace: string
  }): string
  export function actionPaths(invocation: string, checkout: string): ActionPaths
  export function invocationId(input: {
    runId: string | number
    attempt: string | number
    job: string
    random: string
  }): string
  export function allocateInvocation(input: {
    runnerTemp: string
    role: 'run' | 'apply'
    id: string
    checkout: string
  }): ActionPaths
  export function invocationFromEnv(env: Record<string, string | undefined>): string
  export function budgetString(value: unknown): string
  export function parseActionInputs(env: Record<string, string | undefined>): ActionInputs
  export function rawInputs(env: Record<string, string | undefined>): Record<string, string>
  export function readActionInputs(paths: ActionPaths): Promise<ActionInputs>
  export function httpsBase(value: string | undefined, fallback: string, label: string): string
  export function networkInputs(inputs: ActionInputs, workspace: string): ActionNetwork
  export function writeOutputs(
    file: string | undefined,
    record: Record<string, unknown>,
  ): Promise<void>
  export function tidy(env: Record<string, string | undefined>): Promise<void>
}

declare module '*/action/lib/gate.mjs' {
  export const GATE_TASK_MAX_CHARS: number
  export function eventPrNumber(
    eventName: string,
    event: unknown,
    dispatchPrNumber: number | null,
  ): number | null
  export function decide(input: {
    eventName: string
    event: unknown
    pr: unknown
    repository: string
    isPublic: boolean
    runnerEnvironment: string
    mode: 'review' | 'fix'
    imageGeneration: boolean
    triggerPhrase: string
    dispatchPrNumber: number | null
  }): ActionGateDecision
}

declare module '*/action/lib/gate-cli.mjs' {
  export function runGate(input: {
    env: Record<string, string | undefined>
    fetch: typeof fetch
    owner: LauncherOwner
  }): Promise<ActionGateDecision>
}

declare module '*/action/lib/install.mjs' {
  export const AGENT_PACKAGE: string
  export const VERIFIER_NPM: string
  export const SOURCE_REPOSITORY: string
  export const RELEASE_WORKFLOW: string
  export const SLSA_PROVENANCE: string
  export class ProvenanceError extends Error {
    readonly check: string
  }
  export function integrityHex(integrity: unknown): string
  export interface PublisherIdentity {
    repository: string
    workflow: string
    ref: string
    san: string
  }
  export function releaseIdentity(version: string): PublisherIdentity
  export function verifyProvenance(
    audit: unknown,
    expected: { name: string; version: string; integrity: string; identity?: PublisherIdentity },
  ): void
  export function npmEnvironment(
    baseEnv: Record<string, string>,
    paths: ActionPaths,
  ): Record<string, string>
  export function installAgent(input: {
    owner: LauncherOwner
    paths: ActionPaths
    node: string
    npmCli: string
    npxCli: string
    version: string
    workspace: string
    packagePath: string | null
    packageSha256: string | null
    fetch: typeof fetch
    baseEnv: Record<string, string>
  }): Promise<{ agentJs: string; candidate: boolean }>
}

declare module '*/action/lib/checkout.mjs' {
  export function remoteFor(serverUrl: string | undefined, repository: string): string
  export function checkoutHead(input: {
    owner: LauncherOwner
    git: string
    paths: ActionPaths
    baseEnv: Record<string, string>
    directory: string
    remote: string
    shas: readonly string[]
    token: string
  }): Promise<string>
}

declare module '*/action/lib/inputs.mjs' {
  export const ACTION_PROMPT_MAX_BYTES: number
  export function truncateUtf8(
    text: string,
    maxBytes: number,
  ): { text: string; truncated: boolean; bytes: number }
  export function metadataResource(gate: {
    prNumber: number
    headSha: string
    baseSha: string
    title: string
    body: string
  }): { text: string; truncated: boolean }
  export function readGate(file: string): Promise<{ task: string; title: string; body: string }>
  export function stageInputs(input: { paths: ActionPaths; inputs: ActionInputs }): Promise<void>
  export function generateDiff(input: {
    owner: LauncherOwner
    git: string
    paths: ActionPaths
    baseEnv: Record<string, string>
    staged: Pick<ActionStaged, 'baseSha' | 'headSha' | 'maxDiffBytes'>
  }): Promise<{ truncated: boolean; bytes: number }>
  export function fillTemplate(template: string, values: Record<string, string>): string
  export function renderPrompt(input: {
    paths: ActionPaths
    staged: ActionStaged
    diff: { truncated: boolean; bytes: number }
    templatesDir: string
  }): Promise<void>
  export function readStaged(paths: ActionPaths): Promise<ActionStaged>
}

declare module '*/action/lib/result.mjs' {
  export function exitCodeFor(status: string, signal: string | null): number
  export function microUsd(value: unknown): bigint | undefined
  export function isExecResult(value: unknown): boolean
  export function isExecEvent(value: unknown): boolean
  export const PROHIBITED_UPDATE: RegExp
  export const RAW_TOOL_FIELDS: readonly string[]
  export function parseEventsText(text: string): ActionResultLike | undefined
  export function extractResult(input: {
    owner: LauncherOwner
    paths: ActionPaths
    execCode: number
  }): Promise<ActionResultLike | null>
}

declare module '*/action/lib/run-exec.mjs' {
  export const MODEL_API_KEY_PATTERN: RegExp
  export const KEY_VARIABLE: string
  export const INVALID_KEY_MESSAGE: string
  export function takeModelApiKey(env: Record<string, string | undefined>): string | undefined
  export function maskCommand(value: string): string
  export function execArguments(input: {
    agentJs: string
    paths: Pick<ActionPaths, 'checkout' | 'prompt' | 'diff' | 'meta'>
    inputs: ActionInputs
  }): string[]
  export function isBinaryPatch(bytes: Uint8Array): boolean
  export function scanCount(stdout: Uint8Array): number | undefined
  export function runProposal(input: ActionRunInput): Promise<ActionRunReport>
  export function exitCodeFor(report: ActionRunReport, owner: LauncherOwner): number
  export function statusFor(report: ActionRunReport, owner: LauncherOwner): string
  export function outputsFor(
    report: ActionRunReport,
    owner: LauncherOwner,
    paths: ActionPaths,
  ): Record<string, string>
}

declare module '*/action/lib/post.mjs' {
  export const STICKY_MARKER: string
  export function defuseMentions(text: string): string
  export function commentBody(input: {
    result: ActionResultLike
    runUrl: string
    artifactName: string
    mode: 'review' | 'fix'
    patchWithheld: string
    patchPublished: boolean
    literals: readonly string[]
  }): string
  export function postSticky(input: {
    fetch: typeof fetch
    apiUrl: string
    repository: string
    prNumber: number
    token: string
    body: string
    signal: AbortSignal
  }): Promise<'created' | 'updated'>
  export function completedResult(file: string): Promise<ActionResultLike | null>
}

declare module '*/action/apply/lib/apply.mjs' {
  export class ApplyRefusal extends Error {}
  export function validateProposal(input: {
    directory: string
    artifactName: string
    runId: string
    signal: AbortSignal
  }): Promise<{ manifest: Record<string, unknown>; patchFile: string }>
  export function checkPullForPush(pull: unknown, repository: string, headSha: string): string
  export function applyProposal(input: {
    owner: LauncherOwner
    paths: ActionPaths
    git: string
    mode: 'prepare' | 'push'
    artifactName: string
    runId: string
    repository: string
    githubToken: string
    fetch: typeof fetch
    apiUrl: string
    remote: string
    baseEnv: Record<string, string>
  }): Promise<{ ready: true; commitSha: string | null }>
}
