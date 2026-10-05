// M91 lane P public API. Vendor contracts live separately because their event
// inputs, output envelopes and fail-open rules differ. Dispatcher wiring is lane W.
export { type AdapterEvent, type ForeignStdinResult } from './hookFormats/core'
export {
  buildGeminiStdin,
  parseGeminiResult,
  geminiTimeoutMsToSeconds,
  type GeminiHookAnswer,
} from './hookFormats/gemini'
export {
  buildCursorStdin,
  parseCursorResult,
  type CursorAdapterOptions,
} from './hookFormats/cursor'
export {
  buildCopilotStdin,
  parseCopilotResult,
  type CopilotAdapterOptions,
} from './hookFormats/copilot'
export { buildWindsurfStdin, parseWindsurfResult } from './hookFormats/windsurf'
export { buildKiroStdin, parseKiroResult, type KiroAdapterOptions } from './hookFormats/kiro'

export const HOOK_FORMATS = ['gemini', 'cursor', 'copilot', 'windsurf', 'kiro'] as const
export type HookFormat = (typeof HOOK_FORMATS)[number]
