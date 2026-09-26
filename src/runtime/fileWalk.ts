// A folder's files when git cannot list them (not a repository, no git, or
// an untrusted folder, where git would read the repository's own config):
// the walk that stands in for VS Code's file search in the ACP agent
// (PLAN.md D62). Breadth first, relative paths with forward slashes, never
// into `.git` or `node_modules`, never through a link (D24), at most `limit`.

import { readdir } from 'node:fs/promises'
import path from 'node:path'
import type { Logger } from '../host/logger'
import { FILE_WALK_SKIPPED } from '../shared/constants'

export async function walkFiles(
  root: string,
  limit: number,
  log: Logger,
): Promise<readonly string[]> {
  const found: string[] = []
  const folders = ['']
  while (found.length < limit) {
    const folder = folders.shift()
    if (folder === undefined) {
      break
    }
    let entries
    try {
      entries = await readdir(path.join(root, folder), { withFileTypes: true })
    } catch (error: unknown) {
      log.warn(`Could not list ${folder === '' ? root : folder}: ${String(error)}`)
      continue
    }
    for (const entry of entries) {
      const relative = folder === '' ? entry.name : `${folder}/${entry.name}`
      if (FILE_WALK_SKIPPED.has(entry.name)) {
        continue
      }
      if (entry.isDirectory()) {
        folders.push(relative)
      } else if (entry.isFile()) {
        found.push(relative)
      }
    }
  }
  return found.slice(0, limit)
}
