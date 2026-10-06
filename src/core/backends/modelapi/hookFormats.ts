// M91 lane P public API. Round 3 (contract-first): each vendor's hook contract
// is a declarative table under hookFormats/contracts/, and hookFormats/engine.ts
// is its only interpreter. Dispatcher wiring is lane W.
import {
  type HOOK_FORMATS,
  HOOK_MAX_TIMEOUT_SECONDS,
  MILLISECONDS_PER_SECOND,
} from '../../../shared/constants'
import {
  type AdapterOptions,
  type ForeignHookAnswer,
  type VendorContract,
} from './hookFormats/contract'
import { CLINE_CONTRACT } from './hookFormats/contracts/cline'
import { COPILOT_CONTRACT } from './hookFormats/contracts/copilot'
import { CURSOR_CONTRACT } from './hookFormats/contracts/cursor'
import { GEMINI_CONTRACT } from './hookFormats/contracts/gemini'
import { KIRO_CONTRACT } from './hookFormats/contracts/kiro'
import { WINDSURF_CONTRACT } from './hookFormats/contracts/windsurf'
import { type AdapterEvent, type ForeignStdinResult } from './hookFormats/core'
import { buildStdin, parseResult } from './hookFormats/engine'

export { type AdapterEvent, type ForeignStdinResult } from './hookFormats/core'
export {
  type AdapterOptions,
  type ForeignHookAnswer,
  type VendorContract,
} from './hookFormats/contract'
export { confineHookCwd } from './hookFormats/transforms'

// The list lives in constants.ts (lane W), so the session's config parser can
// name the formats without loading the adapters.
export { HOOK_FORMATS } from '../../../shared/constants'
export type HookFormat = (typeof HOOK_FORMATS)[number]

/** Every vendor table, for the property suite and lane W's admission checks. */
export const HOOK_FORMAT_CONTRACTS: Readonly<Record<HookFormat, VendorContract>> = {
  gemini: GEMINI_CONTRACT,
  cursor: CURSOR_CONTRACT,
  copilot: COPILOT_CONTRACT,
  windsurf: WINDSURF_CONTRACT,
  kiro: KIRO_CONTRACT,
  cline: CLINE_CONTRACT,
}

/**
 * The adapter entry for an import record: (source format, Muse event, the
 * record's source event and protocol flavor in `options`, payload).
 */
export function buildForeignStdin(
  format: HookFormat,
  event: AdapterEvent,
  payload: Readonly<Record<string, unknown>>,
  options?: AdapterOptions,
): ForeignStdinResult {
  return buildStdin(HOOK_FORMAT_CONTRACTS[format], event, payload, options)
}

/** The hook's exit code and output as a HookAnswer (never an allow grant). */
export function parseForeignResult(
  format: HookFormat,
  event: AdapterEvent,
  exitCode: number | null,
  stdout: string,
  stderr: string,
  options?: AdapterOptions,
): ForeignHookAnswer {
  return parseResult(HOOK_FORMAT_CONTRACTS[format], event, exitCode, stdout, stderr, options)
}

// Per-vendor entry points kept from round 2 (same inputs; options widened).
export type CursorAdapterOptions = AdapterOptions
export type CopilotAdapterOptions = AdapterOptions
export type GeminiHookAnswer = ForeignHookAnswer
export interface KiroAdapterOptions extends AdapterOptions {
  /** The originating Kiro trigger (its source event). */
  readonly trigger?: string | undefined
}

function kiroOptions(options: KiroAdapterOptions | undefined): AdapterOptions | undefined {
  return options === undefined
    ? undefined
    : { ...options, sourceEvent: options.trigger ?? options.sourceEvent }
}

export function buildCursorStdin(
  event: AdapterEvent,
  payload: Readonly<Record<string, unknown>>,
  options?: CursorAdapterOptions,
): ForeignStdinResult {
  return buildStdin(CURSOR_CONTRACT, event, payload, options)
}

export function parseCursorResult(
  event: AdapterEvent,
  exitCode: number | null,
  stdout: string,
  stderr: string,
  options?: CursorAdapterOptions,
): ForeignHookAnswer {
  return parseResult(CURSOR_CONTRACT, event, exitCode, stdout, stderr, options)
}

export function buildCopilotStdin(
  event: AdapterEvent,
  payload: Readonly<Record<string, unknown>>,
  options?: CopilotAdapterOptions,
): ForeignStdinResult {
  return buildStdin(COPILOT_CONTRACT, event, payload, options)
}

export function parseCopilotResult(
  event: AdapterEvent,
  exitCode: number | null,
  stdout: string,
  stderr: string,
  options?: CopilotAdapterOptions,
): ForeignHookAnswer {
  return parseResult(COPILOT_CONTRACT, event, exitCode, stdout, stderr, options)
}

export function buildGeminiStdin(
  event: AdapterEvent,
  payload: Readonly<Record<string, unknown>>,
  options?: AdapterOptions,
): ForeignStdinResult {
  return buildStdin(GEMINI_CONTRACT, event, payload, options)
}

export function parseGeminiResult(
  event: AdapterEvent,
  exitCode: number | null,
  stdout: string,
  stderr: string,
  options?: AdapterOptions,
): GeminiHookAnswer {
  return parseResult(GEMINI_CONTRACT, event, exitCode, stdout, stderr, options)
}

export function buildWindsurfStdin(
  event: AdapterEvent,
  payload: Readonly<Record<string, unknown>>,
  options?: AdapterOptions,
): ForeignStdinResult {
  return buildStdin(WINDSURF_CONTRACT, event, payload, options)
}

export function parseWindsurfResult(
  event: AdapterEvent,
  exitCode: number | null,
  stdout: string,
  stderr: string,
  options?: AdapterOptions,
): ForeignHookAnswer {
  return parseResult(WINDSURF_CONTRACT, event, exitCode, stdout, stderr, options)
}

export function buildKiroStdin(
  event: AdapterEvent,
  payload: Readonly<Record<string, unknown>>,
  options?: KiroAdapterOptions,
): ForeignStdinResult {
  return buildStdin(KIRO_CONTRACT, event, payload, kiroOptions(options))
}

export function parseKiroResult(
  event: AdapterEvent,
  exitCode: number | null,
  stdout: string,
  stderr: string,
  options?: KiroAdapterOptions,
): ForeignHookAnswer {
  return parseResult(KIRO_CONTRACT, event, exitCode, stdout, stderr, kiroOptions(options))
}

export function buildClineStdin(
  event: AdapterEvent,
  payload: Readonly<Record<string, unknown>>,
  options?: AdapterOptions,
): ForeignStdinResult {
  return buildStdin(CLINE_CONTRACT, event, payload, options)
}

export function parseClineResult(
  event: AdapterEvent,
  exitCode: number | null,
  stdout: string,
  stderr: string,
  options?: AdapterOptions,
): ForeignHookAnswer {
  return parseResult(CLINE_CONTRACT, event, exitCode, stdout, stderr, options)
}

/** Gemini timeouts are milliseconds; ours are whole seconds, capped. */
export function geminiTimeoutMsToSeconds(value: unknown): number | undefined {
  return typeof value !== 'number' || !Number.isFinite(value) || value < 0
    ? undefined
    : Math.min(Math.max(Math.ceil(value / MILLISECONDS_PER_SECOND), 1), HOOK_MAX_TIMEOUT_SECONDS)
}
