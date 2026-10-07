import { readdir } from 'node:fs/promises'
import nodePath from 'node:path'
import { lstatIdentity } from '../../fs/fileIdentity'
import { VAULT_LIMITS } from '../../../shared/constants'
import { type VaultPanelState } from '../../../shared/modelsPanel'
import { VaultMigrationFault } from './ports'

export type AmbientFile = VaultPanelState['ambientFiles'][number]

/** Match names on either platform, never resolve links or inspect their contents. */
export function ambientKind(relativePath: string): AmbientFile['kind'] | null {
  const path = relativePath.replaceAll('\\', '/')
  if (/^\.ssh\/id_[^/]+$/u.test(path) && !path.endsWith('.pub')) return 'ssh'
  switch (path) {
    case '.git-credentials': {
      return 'git'
    }
    case '.netrc': {
      return 'netrc'
    }
    case '.npmrc': {
      return 'npm'
    }
    case '.aws/credentials': {
      return 'aws'
    }
    case '.docker/config.json': {
      return 'docker'
    }
    default: {
      return null
    }
  }
}

export function pathForHome(home: string, relativePath: string): string {
  const paths =
    /^[A-Za-z]:[\\/]/u.test(home) || home.startsWith('\\\\') ? nodePath.win32 : nodePath.posix
  if (!paths.isAbsolute(home)) throw new VaultMigrationFault('invalid')
  return paths.join(home, ...relativePath.replaceAll('\\', '/').split('/'))
}

async function isPlainFile(home: string, relativePath: string): Promise<boolean> {
  const parts = relativePath.split('/')
  for (let index = 0; index < parts.length; index += 1) {
    try {
      const stat = await lstatIdentity(pathForHome(home, parts.slice(0, index + 1).join('/')))
      if (
        stat.isSymbolicLink() ||
        (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())
      )
        return false
    } catch (error: unknown) {
      if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        return false
      throw new VaultMigrationFault('storage')
    }
  }
  return true
}

export async function discoverAmbientFiles(home: string): Promise<readonly AmbientFile[]> {
  const names = ['.git-credentials', '.netrc', '.npmrc', '.aws/credentials', '.docker/config.json']
  try {
    const ssh = await lstatIdentity(pathForHome(home, '.ssh'))
    if (ssh.isDirectory() && !ssh.isSymbolicLink()) {
      const entries = await readdir(pathForHome(home, '.ssh'))
      for (const name of entries) {
        const relative = `.ssh/${name}`
        if (ambientKind(relative) === 'ssh') names.push(relative)
        if (names.length > VAULT_LIMITS.items) throw new VaultMigrationFault('invalid')
      }
    }
  } catch (error: unknown) {
    if (!(
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ))
      throw new VaultMigrationFault('storage')
  }
  const found: AmbientFile[] = []
  for (const relative of names) {
    const kind = ambientKind(relative)
    if (kind !== null && (await isPlainFile(home, relative)))
      found.push({ path: pathForHome(home, relative), kind })
  }
  return found
}
