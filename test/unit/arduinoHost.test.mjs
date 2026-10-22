import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { pack } from '@vscode/vsce/out/package.js'
import { run as runArduinoTests } from '../hosts/arduino-test-runner.mjs'

const launch = vi.hoisted(() => vi.fn())
const fixture = vi.hoisted(() => ({ root: '' }))
vi.mock('playwright-core', () => ({ _electron: { launch } }))
vi.mock('node:child_process', async (importOriginal) => {
  const child = await importOriginal()
  return {
    ...child,
    execFileSync: (file, args, options) => {
      // Completion cases fake the editor: stage only their private archive
      // contents and fake CLI path, without requiring POSIX tools on Windows.
      if (file === 'unzip') {
        const destination = args.at(-1)
        mkdirSync(destination, { recursive: true })
        cpSync(path.join(fixture.root, 'source'), path.join(destination, 'extension'), {
          recursive: true,
        })
        return ''
      }
      return file === 'sh' && args[0].replaceAll('\\', '/').endsWith('/test/hosts/fake-muse.sh')
        ? path.join(fixture.root, 'fake-muse')
        : child.execFileSync(file, args, options)
    },
  }
})
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal()
  return {
    ...fs,
    // Completion tests fake the editor and its receipt; supply only their
    // private artifact fixture. Every other host copy uses the real fs.
    cpSync: (source, destination, options) =>
      fs.cpSync(
        source === path.resolve('dist/test/integration')
          ? path.join(fixture.root, 'integration')
          : source,
        destination,
        options,
      ),
  }
})
// This runner only captures the optional board provider; no native editor.
vi.mock('vscode', () => ({
  version: '0.0.0-test',
  extensions: { getExtension: vi.fn() },
}))

beforeAll(async () => {
  mkdirSync('temp', { recursive: true })
  fixture.root = mkdtempSync(path.resolve('temp/m103a-host-unit-'))
  mkdirSync(path.join(fixture.root, 'integration'))
  const source = path.join(fixture.root, 'source')
  mkdirSync(source)
  writeFileSync(
    path.join(source, 'package.json'),
    JSON.stringify({
      name: 'm103a-host-fixture',
      version: '0.0.0',
      publisher: 'test',
      repository: 'https://github.com/RandyNorthrup/muse-spark-code',
      license: 'MIT',
      engines: { vscode: '^1.99.0', node: '>=22' },
    }),
  )
  writeFileSync(path.join(source, 'README.md'), 'Private fake-only host guard fixture.\n')
  writeFileSync(path.join(source, 'LICENSE'), 'Private test fixture.\n')
  await pack({
    cwd: source,
    dependencies: false,
    packagePath: path.join(fixture.root, 'normal.vsix'),
  })
  const manifestPath = path.join(source, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.engines = { vscode: '^1.96.0', node: '>=20.14.0' }
  writeFileSync(manifestPath, JSON.stringify(manifest))
  await pack({
    cwd: source,
    dependencies: false,
    packagePath: path.join(fixture.root, 'arduino.vsix'),
  })
})
afterAll(() => rmSync(fixture.root, { recursive: true, force: true }))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function run(work, options = {}) {
  return execFileSync(
    process.execPath,
    [
      'test/hosts/arduino.mjs',
      path.join(fixture.root, 'absent-ide'),
      options.archive ?? path.join(fixture.root, 'normal.vsix'),
      work,
    ],
    { encoding: 'utf8', stdio: 'pipe', env: options.env ?? process.env },
  )
}

describe('Arduino host installation guards', () => {
  it('refuses a normal VSIX before launching an editor', () => {
    expect(() => run(path.join(fixture.root, 'wrong-build'))).toThrow('requires the Arduino VSIX')
  })
  it('refuses an incomplete public offline cache before creating a home or launching an editor', () => {
    const work = path.join(fixture.root, 'missing-cache')
    expect(() =>
      run(work, {
        archive: path.join(fixture.root, 'arduino.vsix'),
        env: {
          ...process.env,
          MUSE_ARDUINO_OFFLINE_CACHE: path.join(fixture.root, 'absent-cache'),
        },
      }),
    ).toThrow('Offline Arduino cache is missing package_index.json')
    expect(existsSync(path.join(work, 'home'))).toBe(false)
  })
  it('refuses an existing test home and leaves it byte-exact', () => {
    const work = path.join(fixture.root, 'existing')
    mkdirSync(path.join(work, 'home'), { recursive: true })
    const sentinel = path.join(work, 'home/settings.json')
    writeFileSync(sentinel, 'keep these bytes')
    expect(() => run(work)).toThrow('Use a fresh Arduino test work directory')
    expect(readFileSync(sentinel, 'utf8')).toBe('keep these bytes')
  })
})

describe('Arduino qualification completion guards', () => {
  let runNumber = 0

  async function qualify(stats) {
    const work = path.join(fixture.root, `completion-${String(runNumber++)}`)
    launch.mockImplementation(({ env }) => {
      writeFileSync(env.MUSE_ARDUINO_RESULT, JSON.stringify({ stats }))
      return Promise.resolve({
        process: () => ({ kill: vi.fn() }),
        firstWindow: () =>
          Promise.resolve({
            waitForLoadState: () => Promise.resolve(),
            screenshot: () => Promise.resolve(),
          }),
        close: () => Promise.resolve(),
      })
    })
    vi.spyOn(console, 'log').mockImplementation(vi.fn())
    const previous = process.argv
    process.argv = [
      process.execPath,
      path.resolve('test/hosts/arduino.mjs'),
      path.join(fixture.root, 'absent-ide'),
      path.join(fixture.root, 'arduino.vsix'),
      work,
    ]
    try {
      vi.resetModules()
      await import('../hosts/arduino.mjs')
    } finally {
      process.argv = previous
    }
  }

  it.each([
    ['zero executed tests', { tests: 0, passes: 0, pending: 0, failures: 0 }],
    ['entirely pending suite', { tests: 34, passes: 0, pending: 34, failures: 0 }],
    ['partly pending suite', { tests: 34, passes: 33, pending: 1, failures: 0 }],
    ['missing passes', { tests: 34, pending: 0, failures: 0 }],
    ['inconsistent passes', { tests: 34, passes: 33, pending: 0, failures: 0 }],
  ])('rejects a host receipt with %s', async (_label, stats) => {
    await expect(qualify(stats)).rejects.toThrow('Arduino integration tests failed')
  })

  it('accepts a nonempty fully completed host receipt', async () => {
    await expect(
      qualify({ tests: 34, passes: 34, pending: 0, failures: 0 }),
    ).resolves.toBeUndefined()
  })

  it('rejects empty discovery before invoking the test-cli runner', async () => {
    const work = path.join(fixture.root, 'empty-discovery')
    mkdirSync(path.join(work, 'integration'), { recursive: true })
    mkdirSync(path.join(work, 'hosts'))
    const result = path.join(work, 'result.json')
    const fakeRunner = path.join(work, 'fake-runner.cjs')
    writeFileSync(
      fakeRunner,
      'exports.run = async () => { require("node:fs").writeFileSync(process.env.MUSE_ARDUINO_RESULT, "runner invoked") }',
    )
    vi.stubEnv('MUSE_ARDUINO_RESULT', result)
    vi.stubEnv('MUSE_ARDUINO_TEST_CLI_RUNNER', fakeRunner)
    const callback = vi.fn()
    await runArduinoTests(path.join(work, 'hosts/runner.cjs'), callback)
    expect(callback).toHaveBeenCalledWith(expect.any(Error))
    expect(JSON.parse(readFileSync(result, 'utf8')).error).toContain(
      'No Arduino integration tests discovered',
    )
  })
})
