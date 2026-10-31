import type { CreatedPathProof } from '../../../../src/core/resources/createdRegistry'
import {
  createdTreeCreator,
  isCreatedTreeCreatorGone,
} from '../../../../src/core/resources/createdOwner'

/**
The proof the created-registry tests open with: the native file
commands answer, nothing is retired or archived, and no tree owns the
entries. As the product wires it, Linux's helper answers files only
while macOS and Windows answer directories through the same commands.
The creator proof is the product's own, and `dataDir` is where that
proof may write the installation identity. It is read when a tree is
created, so a fixture can set the directory in `beforeAll`.
*/
export function createdRegistryProof(
  files: (args: readonly string[]) => Promise<string>,
  dataDir: () => string,
): CreatedPathProof {
  return {
    files,
    directories: process.platform === 'linux' ? undefined : files,
    exited: () => Promise.resolve(false),
    creator: () => createdTreeCreator(dataDir()),
    creatorExited: (creator) => isCreatedTreeCreatorGone(creator, dataDir()),
    createdByTree: () => Promise.resolve(false),
    archivedAndClean: () => Promise.reject(new Error('Archive/clean proof is not installed')),
    freeBytes: () => Promise.resolve(null),
  }
}
