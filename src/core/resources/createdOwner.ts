import { exactCurrentProcessOwner, isProcessOwnerGone } from '../locks/processOwner'
import type { CreatedCreator } from './createdRegistry'

/**
This process, as a created tree names it. Exact evidence only: machine,
boot, pid namespace and birth. Anything the system cannot say is omitted,
and a sweep then never ends the entry.
*/
export async function createdTreeCreator(dataDir: string): Promise<CreatedCreator | undefined> {
  const me = await exactCurrentProcessOwner(dataDir)
  if (
    me?.machineId === undefined ||
    me.bootId === undefined ||
    me.pidNamespace === undefined ||
    me.exactBirth === undefined
  )
    return undefined
  return {
    host: me.host,
    pid: me.pid,
    processStart: me.processStart,
    bootId: me.bootId,
    machineId: me.machineId,
    pidNamespace: me.pidNamespace,
    exactBirth: me.exactBirth,
  }
}

/**
Whether a recorded creator is provably gone. Missing machine, boot,
namespace or exact birth is not proof: a pid that is absent in this
namespace can still be the creator, alive in another one.
*/
export async function isCreatedTreeCreatorGone(
  creator: CreatedCreator,
  dataDir: string,
): Promise<boolean> {
  if (
    creator.machineId === undefined ||
    creator.bootId === undefined ||
    creator.pidNamespace === undefined ||
    creator.exactBirth === undefined
  )
    return false
  const me = await exactCurrentProcessOwner(dataDir)
  return me === undefined ? false : await isProcessOwnerGone(creator, { exactOnly: true, self: me })
}
