// TOOLCAP guard: any code that appends a tool result to the conversation
// without passing the one bound fails here. It parses the sources for the
// item kinds that carry tool output, and it pins the caps lattice so a
// pre-existing per-tool cap can never exceed the choke.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  HOOK_OUTPUT_MAX_BYTES,
  OBS_PACK_CHARS_PER_TOKEN,
  OVERFLOW_MAX_REQUEST_SENDS,
  READ_FILE_MAX_LINE_CHARS,
  SEARCH_HIT_MAX_CHARS,
  SUBAGENT_RESULT_TEXT_MAX_CHARS,
  SUBAGENT_SUMMARY_MAX_CHARS,
  TOOL_OUTPUT_MAX_CHARS,
  TOOL_RESULT_MAX_LINE_CHARS,
  TOOL_RESULT_MAX_TOKENS,
  TOOL_RESULT_WINDOW_SHARE,
} from '../../src/shared/constants'

const SRC = path.join(__dirname, '..', '..', 'src')
const ROOT = path.join(__dirname, '..', '..')

function sources(dir: string): string[] {
  const found: string[] = []
  const names = readdirSync(dir)
  for (const name of names) {
    const file = path.join(dir, name)
    if (statSync(file).isDirectory()) found.push(...sources(file))
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) found.push(file)
  }
  return found
}

const CONSTRUCTION = "type: 'function_call_output',"

/**
 * Files allowed to construct `function_call_output` without the bound, and
 * why. Anything else must route through it; a new file here fails.
 */
const ALLOW_CONSTRUCTION = new Map<string, string>([
  // Placeholders, bounded by construction: the render trims to the packing
  // threshold, falling back to a ~1 kB single-line excerpt.
  ['src/core/backends/modelapi/observationPack.ts', 'packed placeholders'],
  // The hook model's own sub-loop history: it never reaches the provider
  // conversation. Only the hook's returned text does, through
  // appendHookContexts, which is bound. History lines stay short by their
  // producers' own caps (read 2k, search hits 500 each).
  ['src/core/backends/modelapi/hookModelEntry.ts', 'hook sub-loop history'],
])

const BOUND_KEYWORDS = [
  'boundToolOutput',
  'boundOutcome',
  'noteChildCut',
  'noteSyncCut',
  'boundHookNote',
  'trimLargestToolOutputs',
  'noteForModel',
  'boundToolResultText',
  'cutNotice',
]
const CONSTANT_FAILURE = 'toolFailure('
/**
 * The two `output:` shapes that never carry fresh tool text: `finishCall`
 * (every caller passes an outcome already through `boundOutcome`, or a
 * constant `toolFailure`) and `skipCalls` (constant refusal strings).
 */
const PRE_BOUNDED_OUTPUT = 'output: outcome.outputParts ?? outcome.output,'
const CONSTANT_OUTPUT = 'output: `Error: ${reason}`,'
const MODEL_TEXT_REFERENCE = 'MODEL_API_MODEL_TEXT.'
const TOOL_TEXT_REFERENCE = ['visibleOutput', 'pending?.text', 'finalText', 'note.text']
// A bare `.output` (never `.outputs`, the stored-output refs) in the window.
const OUTPUT_REFERENCE = /\.output\b/
const SINGLE_LINE_CONSTANT = /^\s*item: noteItem\(MODEL_API_MODEL_TEXT\.\w+\),?$/

function hasBound(window: string): boolean {
  return BOUND_KEYWORDS.some((keyword) => window.includes(keyword))
}

describe('TOOLCAP guard: every tool result passes the one bound', () => {
  it('fails on any function_call_output construction outside the bound', () => {
    const violations: string[] = []
    const files = sources(SRC)
    for (const file of files) {
      const rel = path.relative(ROOT, file).replaceAll('\\', '/')
      if (rel.startsWith('test/')) continue
      const lines = readFileSync(file, 'utf8').split('\n')
      for (const [index, line] of lines.entries()) {
        if (!line.includes(CONSTRUCTION) || ALLOW_CONSTRUCTION.has(rel)) continue
        if (rel !== 'src/core/backends/modelapi/ModelApiHost.ts') {
          violations.push(`${rel}:${String(index + 1)}: unlisted constructor`)
          continue
        }
        const window = lines.slice(Math.max(0, index - 15), index + 16).join('\n')
        const outputLine = lines.slice(index, index + 3).join('\n')
        if (
          !hasBound(window) &&
          !window.includes(CONSTANT_FAILURE) &&
          !outputLine.includes(PRE_BOUNDED_OUTPUT) &&
          !outputLine.includes(CONSTANT_OUTPUT)
        ) {
          violations.push(`${rel}:${String(index + 1)}: no bound within 15 lines`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('fails on any noteItem carrying tool text outside the bound', () => {
    const violations: string[] = []
    const files = sources(path.join(SRC, 'core', 'backends', 'modelapi'))
    for (const file of files) {
      const rel = path.relative(ROOT, file).replaceAll('\\', '/')
      const lines = readFileSync(file, 'utf8').split('\n')
      for (const [index, line] of lines.entries()) {
        if (
          !line.includes('noteItem(') ||
          line.trimStart().startsWith('function noteItem') ||
          SINGLE_LINE_CONSTANT.test(line)
        ) {
          continue
        }
        const window = lines.slice(Math.max(0, index - 25), index + 26).join('\n')
        const isConstant =
          window.includes(MODEL_TEXT_REFERENCE) &&
          TOOL_TEXT_REFERENCE.every((reference) => !window.includes(reference)) &&
          !OUTPUT_REFERENCE.test(window)
        if (!isConstant && !hasBound(window)) {
          violations.push(`${rel}:${String(index + 1)}: ${line.trim()}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('keeps the choke call the pre-bounded allow rests on', () => {
    const host = readFileSync(
      path.join(SRC, 'core', 'backends', 'modelapi', 'ModelApiHost.ts'),
      'utf8',
    )
    expect(host).toContain('await this.boundOutcome(')
  })

  it('pins the caps lattice: no per-tool cap exceeds the choke', () => {
    const tokenChars = TOOL_RESULT_MAX_TOKENS * OBS_PACK_CHARS_PER_TOKEN
    // Today's per-result behaviour is preserved: the token cap in characters
    // equals the long-standing 64k clip.
    expect(tokenChars).toBe(TOOL_OUTPUT_MAX_CHARS)
    expect(READ_FILE_MAX_LINE_CHARS).toBeLessThanOrEqual(TOOL_RESULT_MAX_LINE_CHARS)
    expect(SEARCH_HIT_MAX_CHARS).toBeLessThanOrEqual(TOOL_RESULT_MAX_LINE_CHARS)
    expect(SUBAGENT_RESULT_TEXT_MAX_CHARS).toBeLessThanOrEqual(tokenChars)
    expect(SUBAGENT_SUMMARY_MAX_CHARS).toBeLessThanOrEqual(tokenChars)
    expect(HOOK_OUTPUT_MAX_BYTES).toBeLessThanOrEqual(TOOL_OUTPUT_MAX_CHARS)
    expect(TOOL_RESULT_WINDOW_SHARE).toBeGreaterThan(0)
    expect(TOOL_RESULT_WINDOW_SHARE).toBeLessThan(1)
  })

  it('pins the recovery send bound: first attempt, trim resend, compact resend', () => {
    expect(OVERFLOW_MAX_REQUEST_SENDS).toBe(3)
  })
})
