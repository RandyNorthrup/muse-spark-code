// The Model API backend's native `toolchains` (M110t TA, PLAN.md
// D90.27): the installed packs' capabilities as the pack manager wrote
// them — packs, tools, versions and gate commands. A read in every
// mode: it never writes, runs a command or installs. The reader is
// injected (the node's pack store on a node); without one the call is
// refused as unknown. Gate commands from the file are text only: they
// run solely through M68's verify loop after the person approves them
// as checks, never from this tool. The one stable context line lives
// here too: it names every installed tool's version, changes only when
// packs change, and is absent without packs, so requests without packs
// stay byte-identical.
import * as z from 'zod/mini'
import { MODEL_API_TOOLS, TOOLCHAINS_MODEL_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { toolchainsSchema, type ToolchainsFile } from '../../shared/toolchains'

/** What the model reads in the tool list. */
export const TOOLCHAINS_DESCRIPTION = TOOLCHAINS_MODEL_TEXT.description

/** The tool takes no arguments: any key arrives only as unknown and is refused. */
export const TOOLCHAINS_PARAMETERS: Record<string, unknown> = {}

/** What the injected reader answers: the raw file, or why there is none. */
export type ToolchainsRead =
  { readonly status: 'ok'; readonly value: unknown } | { readonly status: 'missing' | 'corrupt' }

/** Reads toolchains.json's raw JSON; never throws, never parses. */
export type ToolchainsReader = () => Promise<ToolchainsRead>

/** The call's outcome: the file's JSON, or the refusal the model reads. */
export type ToolchainsCallOutcome =
  { readonly ok: true; readonly json: string } | { readonly ok: false; readonly reason: string }

function refused(reason: string): ToolchainsCallOutcome {
  return { ok: false, reason }
}

/** Throws when the turn stopped; read afresh at each call. */
function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error(TOOLCHAINS_MODEL_TEXT.cancelled)
  }
}

/**
A `toolchains` call over an injected reader: strict arguments (any key
is refused), the signal honoured, and the file validated before its
JSON leaves. A throw means the turn stopped, as elsewhere.
*/
export async function runToolchainsCall(
  args: Readonly<Record<string, unknown>>,
  reader: ToolchainsReader | undefined,
  signal: AbortSignal,
): Promise<ToolchainsCallOutcome> {
  if (reader === undefined) {
    return refused(`${TOOLCHAINS_MODEL_TEXT.unknownTool} ${MODEL_API_TOOLS.toolchains}`)
  }
  if (Object.keys(args).length > 0) {
    return refused(`${TOOLCHAINS_MODEL_TEXT.invalidArguments}: ${Object.keys(args).join(', ')}`)
  }
  throwIfCancelled(signal)
  const read = await reader()
  if (read.status !== 'ok') {
    return refused(
      read.status === 'missing'
        ? TOOLCHAINS_MODEL_TEXT.noToolchains
        : TOOLCHAINS_MODEL_TEXT.invalidResult,
    )
  }
  const parsed = toolchainsSchema.safeParse(read.value)
  return parsed.success
    ? { ok: true, json: JSON.stringify(parsed.data) }
    : refused(`${TOOLCHAINS_MODEL_TEXT.invalidResult}: ${z.prettifyError(parsed.error)}`)
}

/**
The one stable context line: every installed tool with its version, in
file order. Absent without packs (no file, or no packs in it), so
requests without packs stay byte-identical.
*/
export function toolchainsLine(file: ToolchainsFile | undefined): string | undefined {
  if (file === undefined || file.packs.length === 0) return undefined
  const tools: string[] = []
  for (const pack of file.packs) {
    for (const tool of pack.tools) tools.push(`${tool.name} ${tool.version}`)
  }
  return tools.length === 0
    ? undefined
    : fill(TOOLCHAINS_MODEL_TEXT.toolchainsContextLine, { tools: tools.join(', ') })
}
