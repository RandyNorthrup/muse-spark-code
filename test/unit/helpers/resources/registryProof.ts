import type { CreatedPathProof } from '../../../../src/core/resources/createdRegistry'

/**
The proof the created-registry tests open with: the native file
commands answer, nothing is retired or archived, and no tree owns the
entries. As the product wires it, Linux's helper answers files only
while macOS and Windows answer directories through the same commands.
*/
export function createdRegistryProof(
  files: (args: readonly string[]) => Promise<string>,
): CreatedPathProof {
  return {
    files,
    directories: process.platform === 'linux' ? undefined : files,
    exited: () => Promise.resolve(false),
    createdByTree: () => Promise.resolve(false),
    archivedAndClean: () => Promise.reject(new Error('Archive/clean proof is not installed')),
    freeBytes: () => Promise.resolve(null),
  }
}
