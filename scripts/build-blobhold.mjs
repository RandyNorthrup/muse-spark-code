// Internal J build, deliberately outside the product build until certification.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export async function buildBlobHold(directory) {
  if (process.platform !== 'linux') throw new Error('The blob hold is Linux-only for now')
  if (!['x64', 'arm64'].includes(process.arch))
    throw new Error('Unsupported blob-hold architecture')
  mkdirSync(directory, { recursive: true })
  const binary = path.resolve(directory, 'muse-blobhold')
  execFileSync(
    '/usr/bin/cc',
    [
      '-std=c11',
      '-O2',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-Wconversion',
      '-Wshadow',
      'native/blobhold/MuseSparkBlobHold.c',
      '-o',
      binary,
    ],
    { stdio: 'inherit', env: { PATH: '/usr/bin:/bin' } },
  )
  return binary
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await buildBlobHold(path.resolve('temp', 'blobhold'))
