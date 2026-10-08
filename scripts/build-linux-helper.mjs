// Build the existing confined native protocol for the current Linux architecture.
// SHA is linked statically; the shipped helper depends only on the system C library.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export function buildLinuxHelper() {
  if (process.platform !== 'linux') return
  if (!['x64', 'arm64'].includes(process.arch))
    throw new Error('Unsupported Linux helper architecture')
  const directory = path.join('native', 'linux', process.arch)
  mkdirSync(directory, { recursive: true })
  execFileSync(
    '/usr/bin/cc',
    [
      '-Os',
      '-s',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-DMUSE_CREATED_STANDALONE',
      'native/darwin/MuseSparkCreated.c',
      '-Wl,--gc-sections',
      '-Wl,-Bstatic',
      '-lcrypto',
      '-Wl,-Bdynamic',
      '-o',
      path.join(directory, 'muse-created'),
    ],
    { stdio: 'inherit', env: { PATH: '/usr/bin:/bin' } },
  )
}
