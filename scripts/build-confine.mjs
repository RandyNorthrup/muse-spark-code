// Internal F1a build, deliberately outside the product build until certification.
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as esbuild from 'esbuild'
import { isEntryPoint } from './lib/entryPoint.mjs'

export async function buildConfine(directory) {
  if (process.platform !== 'linux' && process.platform !== 'darwin')
    throw new Error('B1 is confined on Linux (Landlock) and macOS (Seatbelt) only')
  if (!['x64', 'arm64'].includes(process.arch)) throw new Error('Unsupported B1 architecture')
  const keys = [
    'PROTECTED_PATH_SEGMENTS',
    'PROTECTED_FILE_NAMES',
    'PRIVATE_ATTACHMENT_NAMES',
    'PRIVATE_ATTACHMENT_EXTENSIONS',
    'PRIVATE_ENV_PREFIX',
    'JUDGE_FAST_B1_WALK_MAX_ENTRIES',
    'JUDGE_FAST_B1_WALK_MAX_DEPTH',
    'JUDGE_FAST_B1_MAX_ABI',
    'JUDGE_FAST_B1_MIN_ABI',
    'JUDGE_FAST_B1_DARWIN_ABI',
    'JUDGE_FAST_B1_REFUSED_EXIT',
    'JUDGE_FAST_B1_ELF_MAX_BYTES',
    'JUDGE_FAST_B1_SYSTEM_MAX_FILES',
    'JUDGE_FAST_B1_PROTOCOL_MAX_BYTES',
  ]
  const result = await esbuild.build({
    stdin: {
      contents: `export { ${keys.join(', ')} } from './src/shared/constants'`,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    platform: 'node',
    format: 'esm',
    bundle: true,
    write: false,
    logLevel: 'silent',
  })
  const policy = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`
  )
  const header = [
    '#pragma once',
    '#include <stddef.h>',
    '// Generated from shared constants; never maintain a second privacy policy.',
  ]
  for (const key of keys) {
    const value = policy[key]
    if (typeof value === 'number' || typeof value === 'string')
      header.push(`#define ${key} ${JSON.stringify(value)}`)
    else {
      const names = [...value].map((entry) => (Array.isArray(entry) ? entry.join('/') : entry))
      header.push(
        `static const char *${key}[] = {${names.map((name) => JSON.stringify(name)).join(',')}, NULL};`,
      )
    }
  }
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, 'policy.h'), `${header.join('\n')}\n`)
  const binary = path.resolve(directory, 'muse-confine')
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
      '-I',
      directory,
      process.platform === 'darwin'
        ? 'native/confine/MuseSparkConfineMac.c'
        : 'native/confine/MuseSparkConfine.c',
      '-o',
      binary,
    ],
    { stdio: 'inherit', env: { PATH: '/usr/bin:/bin' } },
  )
  await esbuild.build({
    entryPoints: ['src/core/judge/fast/inspectExec.ts'],
    outfile: path.join(directory, 'inspectExec.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    bundle: true,
    minify: true,
    logLevel: 'silent',
  })
  return binary
}

if (isEntryPoint(import.meta.url)) await buildConfine(path.resolve('temp', 'confine'))
