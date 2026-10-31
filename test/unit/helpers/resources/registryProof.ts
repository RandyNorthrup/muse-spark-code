import type {
  CreatedCreator,
  CreatedPathProof,
} from '../../../../src/core/resources/createdRegistry'
import { currentProcessOwner, isProcessOwnerGone } from '../../../../src/core/locks/processOwner'

/** This process as a created entry names its creator: the product's own owner reading. */
export async function createdCreator(): Promise<CreatedCreator> {
  const me = await currentProcessOwner()
  return {
    host: me.host,
    pid: me.pid,
    processStart: me.processStart,
    ...(me.bootId !== undefined && { bootId: me.bootId }),
  }
}

/**
The proof the created-registry tests open with: the native file
commands answer, nothing is retired or archived, and no tree owns the
entries. As the product wires it, Linux's helper answers files only
while macOS and Windows answer directories through the same commands.
The creator proof is the product's own: this process's owner reading,
and the same gone-check the locks use.
*/
export function createdRegistryProof(
  files: (args: readonly string[]) => Promise<string>,
): CreatedPathProof {
  return {
    files,
    directories: process.platform === 'linux' ? undefined : files,
    exited: () => Promise.resolve(false),
    creator: createdCreator,
    creatorExited: (creator) => isProcessOwnerGone(creator),
    createdByTree: () => Promise.resolve(false),
    archivedAndClean: () => Promise.reject(new Error('Archive/clean proof is not installed')),
    freeBytes: () => Promise.resolve(null),
  }
}
