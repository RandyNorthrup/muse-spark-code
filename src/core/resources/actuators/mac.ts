import * as z from 'zod/mini'
import {
  resourceProcessIdentitySchema,
  type ResourceProcessIdentity,
  type ResourceTicket,
  type ResourceTreeReader,
} from '../../../shared/resources'
import type { ResourceActuatorPort, ResourceControl } from './controls'

const policySchema = z.extend(resourceProcessIdentitySchema, {
  pgid: z.number().check(z.int(), z.gt(0)),
  externalBackground: z.boolean(),
})

export interface MacPolicyPort {
  /** proc_pidinfo's exact start, group and PROC_FLAG_EXT_DARWINBG in one native read. */
  inspect(identity: ResourceProcessIdentity): Promise<z.infer<typeof policySchema> | null>
  /** M96 K/W repeat native identity/group proof at the mutation boundary and scrub child credentials. */
  run(
    ticket: ResourceTicket,
    identity: ResourceProcessIdentity,
    file: string,
    args: readonly string[],
  ): Promise<void>
}

export class MacResourceActuator implements ResourceActuatorPort {
  constructor(
    private readonly deps: {
      readonly registry: ResourceTreeReader
      readonly policy: MacPolicyPort
      /** True only on a platform qualified by lane 0's before/after/restore probe. */
      readonly reversible: boolean
    },
  ) {}

  async controls(ticket: ResourceTicket): Promise<readonly ResourceControl[]> {
    if (ticket.scope.type !== 'group') throw new Error('macOS resource scope must be a group')
    const pgid = ticket.scope.pgid
    const members = await this.deps.registry.members(ticket)
    return members.map((identity): ResourceControl => {
      const read = async (): Promise<string | null> => {
        const raw = await this.deps.policy.inspect(identity)
        if (raw === null) return null
        const policy = policySchema.parse(raw)
        return policy.pid === identity.pid &&
          policy.startTime === identity.startTime &&
          policy.pgid === pgid
          ? String(policy.externalBackground)
          : null
      }
      return {
        key: `taskpolicy/${String(identity.pid)}/${identity.startTime}`,
        name: 'taskpolicy',
        identity,
        reversible: this.deps.reversible,
        minimumLevel: this.deps.reversible ? 'throttle' : 'pause',
        read,
        lower: () => 'true',
        write: async (value) => {
          if (
            !['true', 'false'].includes(value) ||
            (await read()) === null ||
            !(await this.deps.registry.contains(ticket, identity))
          )
            return null
          await this.deps.policy.run(ticket, identity, '/usr/sbin/taskpolicy', [
            value === 'true' ? '-b' : '-B',
            '-p',
            String(identity.pid),
          ])
          return await read()
        },
        close: () => Promise.resolve(),
      }
    })
  }
}
