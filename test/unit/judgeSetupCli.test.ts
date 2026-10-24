// M125 lane W (D107 §8.1): the `judge scan|setup|remove` text steps.
// Scan prints the hardware and the recommendation read-only; setup
// prints its plan and installs only with --yes; remove deletes only
// what setup added, only with --yes. Progress runs on stderr, results
// on stdout; failures name their codes.
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { EXEC_EXIT } from '../../src/shared/constants'
import { loadJudgeModelsTable } from '../../src/core/judge/setup/table'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { formatSetupBytes, type JudgeSetupPorts } from '../../src/core/judge/setup/ports'
import {
  parseSetupFlags,
  runJudgeRemove,
  runJudgeScan,
  runJudgeSetup,
  type JudgeSetupTextIo,
} from '../../src/runtime/judge/setupCli'
import {
  DIGEST,
  GIB,
  PATHS,
  SHIPPED_TABLE,
  STORAGE_ROOT,
  setupPorts,
  type SetupWorld,
} from './helpers/judgeSetupWorld'

interface FakeCli {
  readonly world: SetupWorld
  readonly ports: JudgeSetupPorts
  readonly out: string[]
  readonly err: string[]
}

function fakeCli(overrides: Partial<JudgeSetupPorts> = {}): FakeCli {
  const { world, ports } = setupPorts(overrides)
  return { world, ports, out: [], err: [] }
}

const ioOf = (cli: FakeCli): JudgeSetupTextIo => ({
  stdout: {
    write: (line) => {
      cli.out.push(line)
    },
  },
  stderr: {
    write: (line) => {
      cli.err.push(line)
    },
  },
})

const signal = (): AbortSignal => new AbortController().signal

describe('judge setup CLI', () => {
  beforeEach(() => {
    setUiText(EN, 'en')
  })

  it('parses its own flags and refuses the rest', () => {
    expect(parseSetupFlags([])).toEqual({
      ok: true,
      flags: { cpuOnly: false, model: undefined, yes: false },
    })
    expect(parseSetupFlags(['--cpu-only', '--model', 'tev1:4b', '--yes'])).toEqual({
      ok: true,
      flags: { cpuOnly: true, model: 'tev1:4b', yes: true },
    })
    expect(parseSetupFlags(['--model'])).toEqual({ ok: false })
    expect(parseSetupFlags(['--model', '  '])).toEqual({ ok: false })
    expect(parseSetupFlags(['--budget-usd'])).toEqual({ ok: false })
    expect(parseSetupFlags(['scan'])).toEqual({ ok: false })
  })

  it('scans read-only: the hardware, the pick and its reasons', async () => {
    const cli = fakeCli()
    const code = await runJudgeScan(ioOf(cli), [], cli.ports, PATHS)
    expect(code).toBe(EXEC_EXIT.ok)
    expect(cli.err).toEqual([])
    const text = cli.out.join('')
    expect(text).toContain('OS: linux x64 (test-os)')
    expect(text).toContain('RAM: 17.2 GB (9.7 GB free)')
    expect(text).toContain('CPU: test-cpu (8 cores, avx2)')
    expect(text).toContain('GPU: none (cpu): test: no GPU')
    expect(text).toContain('Disk: 107.4 GB free at ')
    expect(text).toContain('Ollama: not installed')
    expect(text).toContain(`Recommendation: tev1:4b (${DIGEST}, cpu, p95 300 ms)`)
    expect(text).toContain('Classes: ')
    expect(text).toContain('Recommended: tev1:4b')
  })

  it('scans a fit-nothing table as an answer, not a failure', async () => {
    const cli = fakeCli({
      loadTable: (_file, today) => loadJudgeModelsTable(SHIPPED_TABLE, today),
    })
    const code = await runJudgeScan(ioOf(cli), [], cli.ports, PATHS)
    expect(code).toBe(EXEC_EXIT.ok)
    expect(cli.out.join('')).toContain('Recommendation: fits nothing on this machine.')
  })

  it('refuses a scan the table cannot support', async () => {
    const cli = fakeCli({
      loadTable: () => ({ table: undefined, failures: { f: 'missing-file' } }),
    })
    const code = await runJudgeScan(ioOf(cli), [], cli.ports, PATHS)
    expect(code).toBe(EXEC_EXIT.failed)
    expect(cli.err.join('')).toContain('Cannot set up (table-invalid).')
  })

  it('refuses scan flags it does not take', async () => {
    const cli = fakeCli()
    expect(await runJudgeScan(ioOf(cli), ['--model', 'tev1:4b'], cli.ports, PATHS)).toBe(
      EXEC_EXIT.usage,
    )
    expect(await runJudgeScan(ioOf(cli), ['--yes'], cli.ports, PATHS)).toBe(EXEC_EXIT.usage)
    expect(await runJudgeScan(ioOf(cli), ['--bogus'], cli.ports, PATHS)).toBe(EXEC_EXIT.usage)
    expect(cli.err.join('')).toContain('Usage: judge scan')
  })

  it('prints the setup plan and installs nothing without --yes', async () => {
    const cli = fakeCli()
    const code = await runJudgeSetup(ioOf(cli), [], cli.ports, PATHS, signal())
    expect(code).toBe(EXEC_EXIT.failed)
    const text = cli.out.join('')
    expect(text).toContain(`Model: tev1:4b (${DIGEST})`)
    expect(text).toContain('Download: about 4.5 GB plus the runtime archive')
    expect(text).toContain('Runtime: 0.35.1 (https://test.invalid/ollama.tgz)')
    expect(text).toContain('Installs to: ')
    expect(text).toContain('Re-run with --yes to download and install.')
    expect(cli.world.registration).toBeUndefined()
  })

  it('installs with --yes: progress on stderr, the verdict on stdout', async () => {
    const cli = fakeCli()
    const code = await runJudgeSetup(ioOf(cli), ['--yes'], cli.ports, PATHS, signal())
    expect(code).toBe(EXEC_EXIT.ok)
    expect(cli.out.join('')).toContain('Installed tev1:4b: smoke 10/10 correct.')
    expect(cli.err.join('')).toContain('fetch ')
    expect(cli.err.join('')).toContain('smoke ?/?')
    expect(cli.world.registration?.model).toBe('tev1:4b')
  })

  it('names a failed install with its phase and reason', async () => {
    const cli = fakeCli({
      flow: {
        ...fakeCli().ports.flow,
        askSmoke: (questions) =>
          Promise.resolve(questions.map(() => ({ correct: false, latencyMs: 1 }))),
      },
    })
    const code = await runJudgeSetup(ioOf(cli), ['--yes'], cli.ports, PATHS, signal())
    expect(code).toBe(EXEC_EXIT.failed)
    expect(cli.err.join('')).toContain('Setup failed (smoke/smoke-failed).')
  })

  it('refuses an unlisted setup model before scanning anything else', async () => {
    const cli = fakeCli()
    const code = await runJudgeSetup(
      ioOf(cli),
      ['--model', 'qwen3:8b', '--yes'],
      cli.ports,
      PATHS,
      signal(),
    )
    expect(code).toBe(EXEC_EXIT.failed)
    expect(cli.err.join('')).toContain('Cannot set up (model-unlisted).')
  })

  it('removes nothing when nothing is installed', async () => {
    const cli = fakeCli()
    const code = await runJudgeRemove(ioOf(cli), [], cli.ports, PATHS)
    expect(code).toBe(EXEC_EXIT.ok)
    expect(cli.out.join('')).toContain('No local judge installed.')
  })

  it('removes only what setup added, only with --yes', async () => {
    const cli = fakeCli()
    cli.world.registration = {
      version: 1,
      endpoint: 'http://127.0.0.1:11434',
      model: 'tev1:4b',
      digest: DIGEST,
      runtimePath: path.join(STORAGE_ROOT, 'judge', 'runtime', '0.35.1', 'ollama'),
      modelsDir: path.join(STORAGE_ROOT, 'judge', 'models'),
      contextWindow: 4096,
      timeoutMs: 60_000,
      fingerprint: 'test',
      registeredAt: '2026-10-23T00:00:00.000Z',
    }
    const planned = await runJudgeRemove(ioOf(cli), [], cli.ports, PATHS)
    expect(planned).toBe(EXEC_EXIT.failed)
    expect(cli.out.join('')).toContain('Installed: tev1:4b at ')
    expect(cli.world.removed).toEqual([])
    const code = await runJudgeRemove(ioOf(cli), ['--yes'], cli.ports, PATHS)
    expect(code).toBe(EXEC_EXIT.ok)
    expect(cli.out.join('')).toContain('Removed: ')
    expect(cli.world.removed).toHaveLength(4)
    expect(cli.world.registration).toBeUndefined()
  })

  it('refuses remove flags it does not take', async () => {
    const cli = fakeCli()
    expect(await runJudgeRemove(ioOf(cli), ['--model', 'x'], cli.ports, PATHS)).toBe(
      EXEC_EXIT.usage,
    )
    expect(await runJudgeRemove(ioOf(cli), ['--cpu-only'], cli.ports, PATHS)).toBe(EXEC_EXIT.usage)
  })

  it('formats bytes by size in the display language', () => {
    expect(formatSetupBytes(512)).toBe('512 B')
    expect(formatSetupBytes(4_500_000_000)).toBe('4.5 GB')
    expect(formatSetupBytes(16 * GIB)).toBe('17.2 GB')
  })
})
