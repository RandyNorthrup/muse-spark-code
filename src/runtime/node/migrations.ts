import * as z from 'zod/mini'
import { NODE_PROTOCOL_VERSION, UI_TEXT } from '../../shared/constants'
import { nodeStateSchema, type NodeState } from '../../shared/node'

export interface NodeMigration {
  readonly from: number
  readonly to: number
  apply(state: unknown): unknown
}

const version = z.looseObject({ v: z.int().check(z.positive()) })

/** Every forward step is backed up before mutation. No guessed legacy format. */
export async function migrateNodeState(
  input: unknown,
  migrations: readonly NodeMigration[],
  backup: (state: unknown, from: number) => Promise<void>,
): Promise<NodeState> {
  let state = input
  let current = version.parse(state).v
  if (current > NODE_PROTOCOL_VERSION) throw new Error(UI_TEXT.nodeErrors.unsupported)
  while (current < NODE_PROTOCOL_VERSION) {
    const next = migrations.find((migration) => migration.from === current)
    if (next?.to !== current + 1) {
      throw new Error(UI_TEXT.nodeErrors.unsupported)
    }
    await backup(state, current)
    state = next.apply(state)
    if (version.parse(state).v !== next.to) throw new Error(UI_TEXT.nodeErrors.invalidRequest)
    current = next.to
  }
  return nodeStateSchema.parse(state)
}
