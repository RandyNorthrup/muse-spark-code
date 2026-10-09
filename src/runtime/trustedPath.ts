import { constants } from 'node:fs'
import { open, realpath, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { userInfo } from 'node:os'
import * as z from 'zod/mini'
import { runProgram } from '../host/processTree'
import { withoutCredentials, withoutKeyringRoutes } from './credentialVariables'
import { handleIdentity, lstatIdentity, sameFile } from '../core/fs/fileIdentity'
import { LSP_LIMITS, WORKSPACE_IDENTITY_ZERO } from '../shared/constants'

/** System lookups only: never infer exclusive membership from a matching name.
 * A group-writable, not world-writable component is a user-private group only
 * when every check below holds; any lookup failure, empty enumeration or parse
 * error refuses. Returns undefined when admitted, else the precise reason. */
async function privateGroupRefusal(gid: bigint, packageRoot: string): Promise<string | undefined> {
  const env = withoutKeyringRoutes(withoutCredentials(process.env))
  if (process.platform === 'darwin') {
    try {
      const output = await runProgram(
        path.join(packageRoot, 'native', 'darwin', 'muse-dictate'),
        ['private-group', String(gid)],
        env,
      )
      return z.strictObject({ private: z.boolean() }).parse(JSON.parse(output)).private
        ? undefined
        : 'helper refused'
    } catch {
      return 'helper refused'
    }
  }
  // getpwuid(geteuid()).pw_gid is the current user's primary gid. A primary
  // member need not appear in the group's member list, so enumerate passwd
  // (all rows, field 4 is the primary gid) and refuse when any other account
  // holds G. getent initgroups/getgrouplist prove nothing here: glibc prints
  // only supplementary gids, never the primary gid on its own.
  let name: string
  let uid: number
  let primaryGid: number
  try {
    const current = userInfo()
    name = current.username
    uid = current.uid
    primaryGid = current.gid
  } catch {
    return 'user lookup failed'
  }
  if (primaryGid !== Number(gid) || process.getgid?.() !== primaryGid) return 'gid mismatch'
  const want = String(gid)
  const getent = '/usr/bin/getent'
  let groupText: string
  try {
    const output = await runProgram(getent, ['group', want], env)
    groupText = output.trim()
  } catch {
    return 'no group'
  }
  const group = groupText.split(':')
  if (group.length !== LSP_LIMITS.groupFields || group[2] !== want) return 'group malformed'
  if (group[0] !== name) return 'name mismatch'
  if (group[3]?.split(',').some((member) => member !== name && member)) return 'foreign member'
  let usersText: string
  try {
    const output = await runProgram(getent, ['passwd'], env)
    usersText = output.trim()
  } catch {
    return 'passwd failed'
  }
  if (!usersText) return 'passwd empty'
  let hasSelf = false
  for (const line of usersText.split('\n')) {
    const row = line.split(':')
    if (
      !row[0] ||
      row.length !== LSP_LIMITS.passwdFields ||
      !/^\d+$/u.test(row[2] ?? '') ||
      !/^\d+$/u.test(row[3] ?? '')
    )
      return 'passwd malformed'
    if (row[0] === name) {
      if (row[2] !== String(uid) || row[3] !== want) return 'self mismatch'
      hasSelf = true
      continue
    }
    if (row[3] === want) return 'shared gid'
  }
  return hasSelf ? undefined : 'self missing'
}

/** OpenSSH misc.c safe_path / StrictModes, with the root-owned sticky exception.
 * https://github.com/openssh/openssh-portable/blob/master/misc.c
 * Inspect the real ancestry, never treat a selected XDG/home root as authority.
 */
export async function verifyTrustedPath(
  directory: string,
  isPrivateLeaf = true,
  nativeVerify?: (handle: FileHandle) => Promise<void>,
  windowsVerify?: () => Promise<void>,
  packageRoot = path.resolve(__dirname, '..'),
) {
  if (process.platform === 'win32') {
    if (windowsVerify === undefined) throw new Error('ELSP_PRIVATE: native path verifier required')
    // Windows owns the handle/ACL transaction, including CREATE_NEW for records.
    await windowsVerify()
    return
  }
  const canonical = await realpath(directory)
  const uid = process.getuid?.()
  if (uid === undefined) throw new Error('ELSP_PRIVATE: unavailable uid')
  const current = BigInt(uid)
  const components: string[] = []
  for (let next = canonical; ; next = path.dirname(next)) {
    components.unshift(next)
    if (next === path.dirname(next)) break
  }
  // Root-owned OS aliases (/var -> /private/var on Darwin) are immutable to
  // other users. A user-owned alias above a candidate is never a trust anchor.
  if (canonical !== path.resolve(directory)) {
    for (let next = path.resolve(directory); ; next = path.dirname(next)) {
      const info = await lstatIdentity(next)
      if (info.isSymbolicLink() && info.uid !== WORKSPACE_IDENTITY_ZERO)
        throw new Error('ELSP_PRIVATE', {
          cause: new Error(`${directory}: ${next}: symlink ancestor`),
        })
      if (next === path.dirname(next)) break
    }
  }
  let privateGroup: Promise<string | undefined> | undefined
  let requiresUserChild = false
  let leaf
  for (const component of components) {
    const refuse = (reason: string): never => {
      throw new Error('ELSP_PRIVATE', { cause: new Error(`${directory}: ${component}: ${reason}`) })
    }
    const handle = await open(
      component,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
    try {
      const info = await handleIdentity(handle)
      if (!info.isDirectory()) refuse('not a directory')
      if (info.uid !== current && info.uid !== WORKSPACE_IDENTITY_ZERO) refuse('foreign owner')
      if (requiresUserChild && info.uid !== current) refuse('sticky parent needs user-owned child')
      const isGroupWritable = (info.mode & BigInt(constants.S_IWGRP)) !== WORKSPACE_IDENTITY_ZERO
      const isOtherWritable = (info.mode & BigInt(constants.S_IWOTH)) !== WORKSPACE_IDENTITY_ZERO
      let isSafeGroup = false
      let groupRefusal = ''
      if (isGroupWritable && !isOtherWritable && info.gid === BigInt(process.getgid?.() ?? -1)) {
        privateGroup ??= privateGroupRefusal(info.gid, packageRoot)
        const reason = await privateGroup
        isSafeGroup = reason === undefined
        // A refusal throws before any later component reuses the verdict, so
        // the cached reason always belongs to this component's refusal.
        if (reason !== undefined) groupRefusal = `: ${reason}`
      }
      const isWritable = isOtherWritable || (isGroupWritable && !isSafeGroup)
      requiresUserChild =
        isWritable &&
        info.uid === WORKSPACE_IDENTITY_ZERO &&
        (info.mode & BigInt(LSP_LIMITS.stickyMode)) !== WORKSPACE_IDENTITY_ZERO
      if (isWritable && !requiresUserChild) refuse(`group/other writable ancestor${groupRefusal}`)
      if (component === canonical) {
        const mask = constants.S_IRWXU | constants.S_IRWXG | constants.S_IRWXO
        if (
          isPrivateLeaf &&
          (info.uid !== current || (info.mode & BigInt(mask)) !== BigInt(LSP_LIMITS.directoryMode))
        )
          refuse('private leaf requires current uid and 0700')
        if (isPrivateLeaf) {
          try {
            await nativeVerify?.(handle)
          } catch {
            // A departing recovery lock may disappear during the held-fd probe.
            // Preserve ENOENT for its caller; a still-present unsafe path refuses.
            await lstatIdentity(component)
            refuse('native ACL/identity refused')
          }
        }
        leaf = info
      }
      if (!sameFile(await lstatIdentity(component), info)) refuse('pathname replaced')
    } finally {
      await handle.close()
    }
  }
  if (leaf === undefined) throw new Error('ELSP_PRIVATE: missing leaf')
  return { directory: canonical, info: leaf }
}
