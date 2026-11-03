// Each MCP server's tool-definition pins (SEC-MCP-PIN, PLAN.md D42): what
// keeps a server from changing what its tools say or accept after the
// person has them. The first listing of a server (by its launch identity,
// servers.ts) records a SHA-256 of every offered tool's canonical
// definition (toolText.ts); a later listing whose hash differs holds the
// tool back — it is not offered, its old pin stays — until the person
// reads the new text and accepts it, and a new tool on a known server is
// held back the same way. One JSON file beside the era verdicts
// (verdicts.ts), written atomically, holding tool names and their hashes
// only: the server's key hashes its launch as written, and no
// description, schema, command, URL or argument is stored. A file that
// cannot be read keeps no pins, and says so; every server then pins afresh
// on its next listing, as on a first run.

import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import * as z from 'zod/mini'
import { MCP_TOOL_PINS_FILE, MCP_TOOL_PINS_FORMAT } from '../../../../shared/constants'
import { writeFileAtomic } from '../../../fs/atomicFile'
import type { CoreLogger } from '../../../logging'
import { failureForLog } from '../../musecode/logText'
import type { McpToolInfo } from './protocol'
import { canonicalToolDefinition } from './toolText'
import { readKeptJsonFile, verdictKey } from './verdicts'

/** A tool's pin: the SHA-256 of its canonical definition. */
export function toolPinHash(tool: McpToolInfo): string {
  return createHash('sha256').update(canonicalToolDefinition(tool), 'utf8').digest('hex')
}

/** One server's pins, by tool name. */
export type ToolPins = ReadonlyMap<string, string>

const pinsFileSchema = z.object({
  format: z.literal(MCP_TOOL_PINS_FORMAT),
  servers: z.record(z.string(), z.record(z.string(), z.string())),
})

export class McpToolPinStore {
  /** Writes in order, so two servers settling together do not lose one. */
  private writing: Promise<void> = Promise.resolve()

  public constructor(
    private readonly dir: string,
    private readonly log: CoreLogger,
  ) {}

  /** Every kept pin set, by stored key; none when the file is missing or cannot be read. */
  private async readAll(): Promise<Readonly<Record<string, Readonly<Record<string, string>>>>> {
    const read = await readKeptJsonFile(this.dir, MCP_TOOL_PINS_FILE)
    if (read.kind === 'missing') {
      return {}
    }
    if (read.kind === 'unreadable') {
      this.log.warn(
        read.error === undefined
          ? 'The kept MCP tool pins are not readable; every server pins its tools afresh'
          : `The kept MCP tool pins could not be read; every server's tools are pinned afresh: ${failureForLog(read.error)}`,
      )
      return {}
    }
    const parsed = pinsFileSchema.safeParse(read.raw)
    if (!parsed.success) {
      this.log.warn('The kept MCP tool pins are not readable; every server pins its tools afresh')
      return {}
    }
    return parsed.data.servers
  }

  /**
  The pins kept for one server's launch identity, by tool name; undefined
  when that launch was never pinned (its next listing is a first listing).
  */
  public async read(identity: string): Promise<ToolPins | undefined> {
    await this.writing
    const all = await this.readAll()
    const kept = all[verdictKey(identity)]
    return kept === undefined ? undefined : new Map(Object.entries(kept))
  }

  /** Keeps one server's pins, by tool name; a failure to write is logged, never thrown. */
  public async keep(identity: string, pins: ToolPins): Promise<void> {
    const before = this.writing
    const write = (async () => {
      await before
      const stored = Object.fromEntries(pins)
      const servers = { ...(await this.readAll()), [verdictKey(identity)]: stored }
      try {
        await mkdir(this.dir, { recursive: true })
        await writeFileAtomic(
          this.dir,
          MCP_TOOL_PINS_FILE,
          JSON.stringify({ format: MCP_TOOL_PINS_FORMAT, servers }),
        )
      } catch (error: unknown) {
        // The pins hold for this run only; the next start pins afresh.
        this.log.warn(`MCP tool pins could not be kept: ${failureForLog(error)}`)
      }
    })()
    this.writing = write
    await write
  }
}

/** A listed tool held back by its pin, and whether it is new to the server. */
export interface HeldBackTool {
  readonly tool: McpToolInfo
  /** True when the server never had a pin for this tool; false when its text changed. */
  readonly isNew: boolean
}

export interface PinPartition {
  /** The tools whose definition is pinned and unchanged: offered. */
  readonly offered: readonly McpToolInfo[]
  /** The tools with no pin, or a pin their new text does not match: held back. */
  readonly heldBack: readonly HeldBackTool[]
  /**
  The pins after this listing. On a first listing (`pins` undefined) every
  listed tool is pinned and offered; afterwards the kept pins stand, a
  held-back tool's old pin included.
  */
  readonly pins: ToolPins
  /** Whether this was the server's first listing, whose tools were just pinned. */
  readonly isFirstListing: boolean
}

/**
Splits one listing by the server's pins (SEC-MCP-PIN): a first listing
pins and offers everything; afterwards only a tool whose hash matches
its pin is offered, and a changed or new tool is held back with the old
pin kept. Pure.
*/
export function partitionByPins(
  listed: readonly McpToolInfo[],
  pins: ToolPins | undefined,
): PinPartition {
  if (pins === undefined) {
    return {
      offered: listed,
      heldBack: [],
      pins: new Map(listed.map((tool) => [tool.name, toolPinHash(tool)] as const)),
      isFirstListing: true,
    }
  }
  const offered: McpToolInfo[] = []
  const heldBack: HeldBackTool[] = []
  for (const tool of listed) {
    const pin = pins.get(tool.name)
    if (pin === undefined) {
      heldBack.push({ tool, isNew: true })
    } else if (pin === toolPinHash(tool)) {
      offered.push(tool)
    } else {
      heldBack.push({ tool, isNew: false })
    }
  }
  return { offered, heldBack, pins, isFirstListing: false }
}

/** The pins after the person accepts held-back tools: each accepted tool re-pinned. */
export function repinned(pins: ToolPins, accepted: readonly McpToolInfo[]): ToolPins {
  const next = new Map(pins)
  for (const tool of accepted) {
    next.set(tool.name, toolPinHash(tool))
  }
  return next
}
