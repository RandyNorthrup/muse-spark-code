// Desktop observability (M111 lane OB, PLAN.md D91.22): local crash
// capture and its scrub (threat row D64). Every component's crash lands
// as one structured record — fixed kinds, a short code, scrubbed frames
// with sane paths — never as raw memory: raw cores are refused by name
// from the store and the report bundle alike, and Electron's crash
// reporter below never uploads.

import * as z from 'zod/mini'
import {
  O11Y_CRASH_ENTRY_MAX_BYTES,
  O11Y_CRASH_SYMBOL_MAX_CHARS,
  REPORT_ERROR_CODE_MAX_CHARS,
  REPORT_FRAME_PATH_MAX_CHARS,
  REPORT_STACK_MAX_FRAMES,
} from '../../shared/constants'
import { redactSecrets } from '../../shared/redact'
import { O11Y_COMPONENTS, type O11yComponent } from './signals'

/** How a component died, in fixed words. */
export const O11Y_CRASH_KINDS = ['signal', 'panic', 'uncaught', 'oom', 'renderer-killed'] as const
export type O11yCrashKind = (typeof O11Y_CRASH_KINDS)[number]

/** A URI scheme prefix (`https:`, `file:`): never a crash frame path. */
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/
/** A Windows drive root (`C:/`): never a crash frame path. */
const DRIVE_ROOT = /^[A-Za-z]:\//
/** A signal name or error class: a short token, never a sentence. */
const CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u
/**
A Rust symbol path (`muse_shell::bar::render`, with generics): word
characters and the punctuation paths and generics use, never whitespace.
*/
const SYMBOL_PATTERN = /^[A-Za-z_][A-Za-z0-9_:<>(), ]{0,255}$/u

export const crashFrameSchema = z.strictObject({
  /** A component-relative source path, when the frame names one. */
  path: z.optional(z.string().check(z.minLength(1), z.maxLength(REPORT_FRAME_PATH_MAX_CHARS))),
  /** A Rust symbol path, when the frame names one instead. */
  symbol: z.optional(z.string().check(z.minLength(1), z.maxLength(O11Y_CRASH_SYMBOL_MAX_CHARS))),
  line: z.optional(z.int().check(z.gte(1))),
  column: z.optional(z.int().check(z.gte(0))),
})
export type O11yCrashFrame = z.infer<typeof crashFrameSchema>

export const crashRecordSchema = z.strictObject({
  v: z.literal(1),
  /** Milliseconds since the epoch: when the crash was recorded. */
  at: z.int().check(z.gte(0)),
  component: z.enum(O11Y_COMPONENTS),
  kind: z.enum(O11Y_CRASH_KINDS),
  /** The signal or error class, or the fixed unknown word. */
  code: z.string().check(z.minLength(1), z.maxLength(REPORT_ERROR_CODE_MAX_CHARS)),
  /** The scrubbed frames, most recent call first. */
  frames: z.array(crashFrameSchema).check(z.maxLength(REPORT_STACK_MAX_FRAMES)),
})
export type O11yCrashRecord = z.infer<typeof crashRecordSchema>

/** Raw caller data for one crash: scrubbed and validated before writing. */
export interface O11yCrashInput {
  readonly component: string
  readonly kind: string
  /** The raw signal or error class; anything off-shape becomes `unknown`. */
  readonly code: string
  readonly frames?: readonly {
    readonly path?: string
    readonly symbol?: string
    readonly line?: number
    readonly column?: number
  }[]
}

/** Why a crash record was refused: fixed words, never the payload. */
export type O11yCrashRefusal = 'unknownComponent' | 'unknownKind' | 'invalid' | 'oversize'

export type BuiltCrashRecord =
  | { readonly ok: true; readonly record: O11yCrashRecord }
  | { readonly ok: false; readonly reason: O11yCrashRefusal }

const KNOWN_COMPONENTS: ReadonlySet<string> = new Set(O11Y_COMPONENTS)
const KNOWN_KINDS: ReadonlySet<string> = new Set(O11Y_CRASH_KINDS)

function isComponent(component: string): component is O11yComponent {
  return KNOWN_COMPONENTS.has(component)
}

function isKind(kind: string): kind is O11yCrashKind {
  return KNOWN_KINDS.has(kind)
}

/**
A frame path the store may hold: relative, with no empty, dot or dot-dot
segments, no backslashes, no drive root and no URI scheme. A path the
redactor changes (a secret-shaped value) never lands: the frame is
dropped, not repaired.
*/
function scrubFramePath(path: string): string | undefined {
  const scrubbed = redactSecrets(path)
  if (scrubbed !== path) return undefined
  if (scrubbed.length === 0 || scrubbed.length > REPORT_FRAME_PATH_MAX_CHARS) return undefined
  if (scrubbed.includes('\\')) return undefined
  if (scrubbed.startsWith('/')) return undefined
  if (DRIVE_ROOT.test(scrubbed) || URI_SCHEME.test(scrubbed)) return undefined
  const segments = scrubbed.split('/')
  return segments.some((segment) => ['', '.', '..'].includes(segment)) ? undefined : scrubbed
}

function scrubSymbol(symbol: string): string | undefined {
  const scrubbed = redactSecrets(symbol)
  if (scrubbed !== symbol) return undefined
  if (scrubbed.length === 0 || scrubbed.length > O11Y_CRASH_SYMBOL_MAX_CHARS) return undefined
  return SYMBOL_PATTERN.test(scrubbed) ? scrubbed : undefined
}

function scrubFrames(frames: O11yCrashInput['frames']): O11yCrashFrame[] {
  const kept: O11yCrashFrame[] = []
  const items = frames ?? []
  for (const frame of items) {
    if (kept.length >= REPORT_STACK_MAX_FRAMES) break
    const path = frame.path === undefined ? undefined : scrubFramePath(frame.path)
    if (path === undefined && frame.path !== undefined) continue
    const symbol = frame.symbol === undefined ? undefined : scrubSymbol(frame.symbol)
    if (symbol === undefined && frame.symbol !== undefined) continue
    if (path === undefined && symbol === undefined) continue
    if (frame.line !== undefined && (!Number.isSafeInteger(frame.line) || frame.line < 1)) continue
    if (frame.column !== undefined && (!Number.isSafeInteger(frame.column) || frame.column < 0)) {
      continue
    }
    kept.push({
      ...(path !== undefined && { path }),
      ...(symbol !== undefined && { symbol }),
      ...(frame.line !== undefined && { line: frame.line }),
      ...(frame.column !== undefined && { column: frame.column }),
    })
  }
  return kept
}

/** Scrub and validate one crash; refused records never reach the file. */
export function buildCrashRecord(input: O11yCrashInput, at: number): BuiltCrashRecord {
  if (!isComponent(input.component)) return { ok: false, reason: 'unknownComponent' }
  if (!isKind(input.kind)) return { ok: false, reason: 'unknownKind' }
  if (!Number.isSafeInteger(at) || at < 0) return { ok: false, reason: 'invalid' }
  const code =
    CODE_PATTERN.test(input.code) && redactSecrets(input.code) === input.code
      ? input.code
      : 'unknown'
  const candidate = {
    v: 1,
    at,
    component: input.component,
    kind: input.kind,
    code,
    frames: scrubFrames(input.frames),
  }
  const parsed = crashRecordSchema.safeParse(candidate)
  if (!parsed.success) return { ok: false, reason: 'invalid' }
  return Buffer.byteLength(serializeCrashRecord(parsed.data), 'utf8') > O11Y_CRASH_ENTRY_MAX_BYTES
    ? { ok: false, reason: 'oversize' }
    : { ok: true, record: parsed.data }
}

/** One record as its store line, newline-terminated for crash-safe appends. */
export function serializeCrashRecord(record: O11yCrashRecord): string {
  return `${JSON.stringify(record)}\n`
}

/** Parse one store line back: anything off-shape reads absent, never trusted. */
export function parseCrashLine(line: string): O11yCrashRecord | undefined {
  let candidate: unknown
  try {
    candidate = JSON.parse(line) as unknown
  } catch (error: unknown) {
    // Only a malformed store line reads absent: anything else keeps its
    // kind past the store.
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
  const parsed = crashRecordSchema.safeParse(candidate)
  return parsed.success ? parsed.data : undefined
}

/** Electron's `crashReporter.start` options as the app passes them. */
export interface ElectronCrashReporterInput {
  readonly companyName: string
  readonly productName: string
  readonly submitURL?: string
  readonly uploadToServer?: boolean
  readonly rateLimit?: boolean
  readonly compress?: boolean
}

/**
The crash reporter's options with the upload forced off (D64): whatever
the caller asked for, nothing is uploaded anywhere. The `submitURL` is
dropped with it, since there is nowhere to submit to.
*/
export function electronCrashReporterOptions(input: ElectronCrashReporterInput): {
  readonly companyName: string
  readonly productName: string
  readonly uploadToServer: false
  readonly rateLimit: boolean
  readonly compress: boolean
} {
  return {
    companyName: input.companyName,
    productName: input.productName,
    uploadToServer: false,
    rateLimit: input.rateLimit ?? true,
    compress: input.compress ?? true,
  }
}

/**
Whether a file name is a raw memory dump: a `core` file or a crashpad
minidump. Raw dumps never enter the store or the report bundle (D64: a
pattern scrub cannot clean raw memory, hence the exclusion); only
scrubbed records do.
*/
export function isRawCoreName(name: string): boolean {
  const normalized = name.replaceAll('\\', '/')
  const base = normalized.slice(normalized.lastIndexOf('/') + 1)
  return (
    base === 'core' || base.startsWith('core.') || base.endsWith('.core') || base.endsWith('.dmp')
  )
}
