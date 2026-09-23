// VS Code's attribution of resources to workspace folders, over URI strings:
// `getWorkspaceFolder` names the innermost folder whose URI is the
// resource's or a prefix of it at a `/` (a folder's own URI naming itself),
// and `asRelativePath` is relative to that folder, a folder's own URI
// relative to the folder around it (its `resolveParent`). Case-sensitive, as
// a Linux file system is.

import type { FolderLookup, WorkspaceFolderRef } from '../../../src/core/workspaceRoot'

export function fakeFolders(folderUris: readonly string[]): FolderLookup<string> {
  const folders = folderUris.map((uri, index): WorkspaceFolderRef<string> => ({ index, uri }))
  const innermost = (uri: string, isItselfExcluded: boolean) =>
    folders
      .filter(
        (folder) => (!isItselfExcluded && folder.uri === uri) || uri.startsWith(`${folder.uri}/`),
      )
      .toSorted((a, b) => b.uri.length - a.uri.length)[0]
  return {
    folderOf: (uri) => innermost(uri, false),
    relativePath: (uri) => {
      const isFolder = folders.some((folder) => folder.uri === uri)
      const folder = innermost(uri, isFolder)
      return folder === undefined ? uri : uri.slice(folder.uri.length + 1)
    },
    parentOf: (uri) => uri.slice(0, uri.lastIndexOf('/')),
    isSame: (a, b) => a === b,
  }
}
