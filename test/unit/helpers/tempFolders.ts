import { rmSync } from 'node:fs'
export function removeTestFolders(folders: string[]): void {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
}
