// Backup and restore (M110f lane O, D90.19): a backup is the data tree
// copied beside a manifest of SHA-256 hashes, and a restore verifies
// every hash before a byte lands. Symlinks are refused on the way in,
// and manifest paths cannot escape the target on the way out.
import { createHash } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'

const BACKUP_MANIFEST = 'backup.json'
const BACKUP_FILES = 'files'
const SHA256_HEX_CHARS = 64

export const backupEntrySchema = z.strictObject({
  path: z.string().check(z.minLength(1)),
  sha256: z.string().check(z.minLength(SHA256_HEX_CHARS), z.maxLength(SHA256_HEX_CHARS)),
  bytes: z.int().check(z.gte(0)),
})
export type BackupEntry = z.infer<typeof backupEntrySchema>

export const backupManifestSchema = z.strictObject({
  version: z.literal(1),
  entries: z.array(backupEntrySchema),
})
export type BackupManifest = z.infer<typeof backupManifestSchema>

async function listDataFiles(root: string): Promise<readonly string[]> {
  const found: string[] = []
  const visit = async (directory: string): Promise<void> => {
    const names = await readdir(directory)
    for (const name of names) {
      const file = path.join(directory, name)
      const stat = await lstat(file)
      if (stat.isSymbolicLink()) throw new Error(`a backup never follows links: ${file}`)
      if (stat.isDirectory()) await visit(file)
      else if (stat.isFile()) found.push(path.relative(root, file))
    }
  }
  await visit(root)
  return found.toSorted((left, right) => {
    if (left === right) return 0
    return left < right ? -1 : 1
  })
}

function manifestPathOf(backupDir: string): string {
  return path.join(backupDir, BACKUP_MANIFEST)
}

/** Copy the data tree beside its hash manifest. */
export async function createNodeBackup(
  dataDir: string,
  backupDir: string,
): Promise<BackupManifest> {
  const files = await listDataFiles(dataDir)
  await mkdir(path.join(backupDir, BACKUP_FILES), { recursive: true })
  const entries: BackupEntry[] = []
  for (const relative of files) {
    const content = await readFile(path.join(dataDir, relative))
    const target = path.join(backupDir, BACKUP_FILES, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content)
    entries.push({
      path: relative,
      sha256: createHash('sha256').update(content).digest('hex'),
      bytes: content.length,
    })
  }
  const manifest = backupManifestSchema.parse({ version: 1, entries })
  await writeFile(manifestPathOf(backupDir), JSON.stringify(manifest, null, 2))
  return manifest
}

/** Verify every hash, then restore; a mismatch names its file and stops. */
export async function restoreNodeBackup(backupDir: string, dataDir: string): Promise<void> {
  const raw: unknown = JSON.parse(await readFile(manifestPathOf(backupDir), 'utf8'))
  const manifest = backupManifestSchema.parse(raw)
  for (const entry of manifest.entries) {
    const target = path.normalize(path.join(dataDir, entry.path))
    if (!target.startsWith(path.normalize(dataDir) + path.sep))
      throw new Error(`a backup never escapes its target: ${entry.path}`)
    const content = await readFile(path.join(backupDir, BACKUP_FILES, entry.path))
    if (createHash('sha256').update(content).digest('hex') !== entry.sha256)
      throw new Error(`backup file changed since its backup: ${entry.path}`)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content)
  }
}

/** Remove a backup the person no longer wants. */
export async function removeNodeBackup(backupDir: string): Promise<void> {
  await rm(backupDir, { recursive: true, force: true })
}
