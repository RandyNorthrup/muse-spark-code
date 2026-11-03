// Each MCP server's era verdict, kept across restarts (PLAN.md D213; spec
// 2026-07-28 `basic/versioning#backward-compatibility-with-initialization-
// based-versions`: the era "is a property of the server", and clients "MAY
// persist it across restarts of the same server configuration, re-probing
// if the cached assumption later fails"). One JSON file in a folder the
// host names, written atomically. A verdict is keyed by a hash of the
// server's launch as its settings entry writes it, before `${VAR}`
// expansion, so no value from the environment reaches the key, and only
// the hash is stored: never a name, command, URL or argument. A verdict is
// an era and, for a modern server, the revision it speaks. A file that
// cannot be read keeps no verdict, and says so; every server is then
// probed, as on a first run.

import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { MCP_ERA_VERDICTS_FILE, MCP_ERA_VERDICTS_FORMAT } from '../../../../shared/constants'
import { writeFileAtomic } from '../../../fs/atomicFile'
import { isErrno } from '../../../fs/errno'
import type { CoreLogger } from '../../../logging'
import { failureForLog } from '../../musecode/logText'

const keptVerdictSchema = z.union([
  z.object({ era: z.literal('modern'), version: z.string() }),
  z.object({ era: z.literal('legacy') }),
])
export type KeptVerdict = z.infer<typeof keptVerdictSchema>

const verdictsFileSchema = z.object({
  format: z.literal(MCP_ERA_VERDICTS_FORMAT),
  verdicts: z.record(z.string(), keptVerdictSchema),
})

/** The key of one server's verdict: a hash of its launch as its entry writes it. */
export function verdictKey(identity: string): string {
  return createHash('sha256').update(identity, 'utf8').digest('hex')
}

/** Whether two verdicts say the same. */
export function isSameVerdict(a: KeptVerdict, b: KeptVerdict): boolean {
  return a.era === b.era && (a.era === 'legacy' || (b.era === 'modern' && a.version === b.version))
}

/**
One kept JSON file read (the verdicts', the tool pins'): missing on a
first run, unreadable with its failure when the read or the parse fails
(never with its text), or read with the parsed value for the caller's
schema. Shared so both stores judge a kept file the same way.
*/
export type KeptFileRead =
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable'; readonly error?: unknown }
  | { readonly kind: 'read'; readonly raw: unknown }

export async function readKeptJsonFile(dir: string, file: string): Promise<KeptFileRead> {
  let text: string
  try {
    text = await readFile(path.join(dir, file), 'utf8')
  } catch (error: unknown) {
    return isErrno(error) && error.code === 'ENOENT'
      ? { kind: 'missing' }
      : { kind: 'unreadable', error }
  }
  try {
    return { kind: 'read', raw: JSON.parse(text) }
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
    return { kind: 'unreadable' }
  }
}

export class McpVerdictStore {
  /** Writes in order, so two servers settling together do not lose one. */
  private writing: Promise<void> = Promise.resolve()

  public constructor(
    private readonly dir: string,
    private readonly log: CoreLogger,
  ) {}

  /** Every kept verdict; none when the file is missing or cannot be read. */
  private async readAll(): Promise<Readonly<Record<string, KeptVerdict>>> {
    const read = await readKeptJsonFile(this.dir, MCP_ERA_VERDICTS_FILE)
    if (read.kind === 'missing') {
      return {}
    }
    if (read.kind === 'unreadable') {
      // A read failure names its kind; a parse failure names nothing.
      this.log.warn(
        read.error === undefined
          ? 'The kept MCP era verdicts are not readable; every server is probed'
          : `The kept MCP era verdicts could not be read; every server is probed: ${failureForLog(read.error)}`,
      )
      return {}
    }
    const parsed = verdictsFileSchema.safeParse(read.raw)
    if (!parsed.success) {
      this.log.warn('The kept MCP era verdicts are not readable; every server is probed')
      return {}
    }
    return parsed.data.verdicts
  }

  /** The verdict kept for a server, or undefined. */
  public async read(key: string): Promise<KeptVerdict | undefined> {
    await this.writing
    const verdicts = await this.readAll()
    return verdicts[key]
  }

  /** Keeps a server's verdict; a failure to write is logged, never thrown. */
  public async keep(key: string, verdict: KeptVerdict): Promise<void> {
    const before = this.writing
    const write = (async () => {
      await before
      const verdicts = { ...(await this.readAll()), [key]: verdict }
      try {
        await mkdir(this.dir, { recursive: true })
        await writeFileAtomic(
          this.dir,
          MCP_ERA_VERDICTS_FILE,
          JSON.stringify({ format: MCP_ERA_VERDICTS_FORMAT, verdicts }),
        )
      } catch (error: unknown) {
        // The verdict holds for this run only; the next start probes.
        this.log.warn(`An MCP era verdict could not be kept: ${failureForLog(error)}`)
      }
    })()
    this.writing = write
    await write
  }
}
