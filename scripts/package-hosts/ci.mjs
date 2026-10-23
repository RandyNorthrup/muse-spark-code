import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOSTS } from './manifest.mjs'

/** A shared-runtime change selects all hosts; isolated native changes select their host. */
export function hostMatrix(files) {
  const normalized = files?.map((file) => file.replaceAll('\\', '/'))
  const all = normalized === undefined || normalized.some((file) => !file.startsWith('hosts/'))
  return {
    include: Object.entries(HOSTS)
      .filter(([host]) => all || normalized.some((file) => file.startsWith(`hosts/${host}/`)))
      .map(([host, { os }]) => ({ host, os })),
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.env.MUSE_BASE_SHA
    ? execFileSync('git', ['diff', '--name-only', process.env.MUSE_BASE_SHA, 'HEAD'], {
        encoding: 'utf8',
      })
        .trim()
        .split('\n')
        .filter(Boolean)
    : undefined
  const matrix = hostMatrix(files)
  const present = matrix.include
    .filter(({ host }) => existsSync(path.join('hosts', host)))
    .map(({ host }) => host)
  for (const line of [`matrix=${JSON.stringify(matrix)}`, `present=${JSON.stringify(present)}`]) {
    console.log(line)
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`)
  }
}
