import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/**
Build the shipped portal recorder for this Linux architecture: the
ScreenCast portal client and encoder supervisor behind M105's Linux
screen driver. libc only; no D-Bus or multimedia libraries. Sources
resolve from the repository root; only the output directory moves, so
the driver's real-helper tests build the same binary into their own
root.
@param {string} [directory] the native tree receiving the helper.
*/
export function buildPortalRecord(directory = path.join('native', 'linux', process.arch)) {
  if (process.platform !== 'linux') return
  if (!['x64', 'arm64'].includes(process.arch))
    throw new Error('Unsupported portal recorder architecture')
  mkdirSync(directory, { recursive: true })
  execFileSync(
    '/usr/bin/cc',
    [
      '-Os',
      '-s',
      '-Wall',
      '-Wextra',
      '-Werror',
      'native/posix/portalRecord.c',
      '-o',
      path.join(directory, 'muse-portal-record'),
    ],
    { stdio: 'inherit', env: { PATH: '/usr/bin:/bin' } },
  )
}
