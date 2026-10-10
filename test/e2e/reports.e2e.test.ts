import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const run = promisify(execFile)
const state = { root: '', command: '' }
const sourceRoot = path.resolve(import.meta.dirname, '../..')

beforeAll(async () => {
  state.root = await mkdtemp(path.join(os.tmpdir(), 'm113-reports-cli-'))
  state.command = path.join(state.root, 'dist', 'acp.js')
  await mkdir(path.join(state.root, 'dist'))
  await mkdir(path.join(state.root, 'l10n'))
  await writeFile(path.join(state.root, 'package.json'), JSON.stringify({ version: '0.14.2' }))
  await copyFile(
    path.join(sourceRoot, 'test/fixtures/reports/project.json.golden'),
    path.join(state.root, 'fixture.json'),
  )
  await copyFile(path.join(sourceRoot, 'l10n/ui.de.json'), path.join(state.root, 'l10n/ui.de.json'))
  // One memoized build per suite; each child runs the real runtime main and lazy loader.
  await build({
    entryPoints: [path.join(sourceRoot, 'src/runtime/main.ts')],
    outfile: state.command,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['@napi-rs/keyring'],
    logLevel: 'silent',
  })
  await build({
    entryPoints: [path.join(sourceRoot, 'test/e2e/reportsEntry.ts')],
    outfile: path.join(state.root, 'dist/reporting.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  })
})

afterAll(async () => {
  await rm(state.root, { recursive: true, force: true })
})

async function cli(args: readonly string[]) {
  // No credential variables are inherited; no keyring or backend is invoked.
  try {
    const result = await run(process.execPath, [state.command, 'report', ...args], {
      cwd: state.root,
      env: {
        PATH: process.env['PATH'],
        SystemRoot: process.env['SystemRoot'],
        LC_ALL: 'en_US.UTF-8',
      },
    })
    return { code: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error: unknown) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      !('stdout' in error) ||
      !('stderr' in error)
    )
      throw error
    return { code: error.code, stdout: error.stdout, stderr: error.stderr }
  }
}

describe('reports CLI subprocess', () => {
  // One child build is shared in beforeAll; each case below stays at two
  // sequential invocations so slower rigs keep the default deadline.
  it.each(['md', 'html', 'json', 'text'] as const)(
    're-renders saved format %s byte for byte and saves exact output',
    async (format) => {
      const expected = await readFile(
        path.join(
          sourceRoot,
          'test/fixtures/reports',
          format === 'html' ? 'project.cli.html.golden' : `project.${format}.golden`,
        ),
        'utf8',
      )
      const result = await cli(['--from', 'fixture.json', '--format', format])
      expect(result).toEqual({ code: 0, stdout: expected, stderr: '' })
      const out = `saved.${format}`
      expect(await cli(['--from', 'fixture.json', '--format', format, '--out', out])).toEqual({
        code: 0,
        stdout: '',
        stderr: '',
      })
      expect(await readFile(path.join(state.root, out), 'utf8')).toBe(expected)
    },
  )

  it('generates with a fixed as-of and holds a strict condition without model output', async () => {
    expect(await cli(['project', '--as-of', '2026-10-06T12:00:00+00:00'])).toMatchObject({
      code: 0,
    })
    const held = await cli(['project', '--strict'])
    expect(held.code).toBe(4)
    expect(held.stdout).toEqual(expect.stringContaining('Needs you'))
    expect(held.stderr).toBe('')
  })

  it('returns usage and failure codes without model output', async () => {
    expect(
      await cli(['project', '--out', path.join(state.root, 'missing', 'file.md')]),
    ).toMatchObject({ code: 1 })
    expect(await cli(['project', '--format', 'yaml'])).toMatchObject({ code: 2 })
  })

  it('returns not-found for an unknown milestone scope', async () => {
    expect(await cli(['milestone', 'M999'])).toMatchObject({ code: 3 })
  })

  it('rejects damaged JSON and linked saved imports without echoing file contents', async () => {
    await writeFile(path.join(state.root, 'broken.json'), '{ CANARY-never-echo')
    expect(await cli(['--from', 'broken.json'])).toEqual({
      code: 1,
      stdout: '',
      stderr: 'The report could not be generated.\n',
    })
    await symlink(path.join(state.root, 'fixture.json'), path.join(state.root, 'linked.json'))
    expect(await cli(['--from', 'linked.json'])).toMatchObject({ code: 1 })
  })

  it('uses a real installed translation and leaves collection inactive for --from', async () => {
    const result = await cli(['--from', 'fixture.json', '--lang', 'de'])
    expect(result.code).toBe(0)
    expect(result.stdout).toEqual(expect.stringContaining('# Projekt'))
    expect(result.stderr).not.toEqual(expect.stringContaining('backend'))
  })
})
