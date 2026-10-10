// Types for the shared CI runner (ci-templates/muse-spark-run.mjs, lane
// CM80CI), as the template tests import it. The module ships without
// TypeScript; these declarations describe its exports for the tests' type
// checks only.

declare module '*/ci-templates/muse-spark-run.mjs' {
  export const KEY_VARIABLE: string
  export const MODEL_API_KEY_PATTERN: RegExp
  export const CI_DEFAULTS: {
    mode: string
    imageGeneration: string
    maxRequests: string
    timeoutMinutes: string
    model: string
    effort: string
    allowContributorModels: string
    maxDiffBytes: string
    agentBin: string
    agentVersion: string
    outDir: string
  }
  export class InputError extends Error {}
  export function toPosix(value: string): string
  export function toExecPair(bin: string): [string, string[]]
  export function takeModelApiKey(env: Record<string, string | undefined>): string | undefined
  export interface RunnerInputs {
    mode: 'review' | 'fix'
    maxBudgetUsd: string
    imageGeneration: boolean
    maxRequests: number
    timeoutMinutes: number
    model: string
    effort: string
    allowContributorModels: boolean
    maxDiffBytes: number
    promptText: string
    untrustedFiles: string[]
    workspace: string
    agentBin: string
    outDir: string
  }
  export function parseRunnerInputs(env: Record<string, string | undefined>): RunnerInputs
  export function execArguments(inputs: RunnerInputs): string[]
  export function statusForExitCode(code: number): string
  export interface RunResult {
    exitCode: number
    refused?: string
    error?: string
    stdout?: string
    stderr?: string
  }
  export function runOnce(
    env: Record<string, string | undefined>,
    overrides?: { spawn?: unknown },
  ): Promise<RunResult>
  export interface InstallResult {
    exitCode: number
    error?: string
  }
  export function installAgent(
    env: Record<string, string | undefined>,
    overrides?: { spawn?: unknown },
  ): Promise<InstallResult>
}
