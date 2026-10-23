// M125 lane H: the hardware scan. Parsers over the recorded linuxlt
// captures and M98's Ollama wire captures; live probes against this
// machine (portable assertions only — CI runs this file on three
// OSes); the benchmark's bound; the fingerprint's stability. POSIX
// sysfs tests skip off Linux; the smi-missing branch skips where a
// real nvidia-smi answers.
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCpuBenchmark } from '../../src/core/judge/hardware/benchmark'
import { hardwareFingerprint } from '../../src/core/judge/hardware/fingerprint'
import {
  cpuFeaturesFromFlags,
  parseCimVideo,
  parseLinuxCpuinfo,
  parseNvidiaSmi,
  parseOllamaBinaryVersion,
  parseOllamaHost,
  parseOllamaPs,
  parseOllamaTags,
  parseOllamaVersion,
  parseSysctlFeatures,
  pciVendorFromId,
} from '../../src/core/judge/hardware/parse'
import {
  findOnPath,
  hasUsableNvidiaSmi,
  listDrmCards,
  nvidiaSmiCandidates,
  probeCpu,
  probeDiskFree,
  probeGpu,
  probeOllama,
  readPciVendor,
  runProbe,
} from '../../src/core/judge/hardware/probes'
import { scanHardware } from '../../src/core/judge/hardware/scan'
import type { HardwareSummary } from '../../src/core/judge/hardware/types'
import { FIXTURE_HOOK_TIMEOUT_MS } from './helpers/fixtureBudget'

const helperRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'helpers',
  'judgeHardware',
)
const helper = (name: string): Promise<string> => readFile(path.join(helperRoot, name), 'utf8')

const isLinux = process.platform === 'linux'
const isX64 = process.arch === 'x64'

describe('judge hardware scan', () => {
  let scratch = ''
  let isSmiPresent = false

  beforeAll(async () => {
    scratch = await mkdtemp(path.join(tmpdir(), 'judge-hardware-'))
    isSmiPresent = await hasUsableNvidiaSmi()
  }, FIXTURE_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    if (scratch) await rm(scratch, { recursive: true, force: true })
  })

  it('reads the recorded cpuinfo: model, cores and AVX2 without AVX-512', async () => {
    const parsed = parseLinuxCpuinfo(await helper('cpuinfo-linuxlt.txt'))
    expect(parsed?.model).toBe('Intel(R) Core(TM) i7-10510U CPU @ 1.80GHz')
    expect(parsed?.cores).toBe(8)
    expect(parsed?.features).toEqual(['avx2'])
    // The AVX-512 branch over the recorded flags plus its token.
    const flags = /^flags\s*:.*$/m.exec(await helper('cpuinfo-linuxlt.txt'))?.[0] ?? ''
    expect(cpuFeaturesFromFlags(`${flags} avx512f`)).toEqual(['avx2', 'avx512'])
    expect(parseLinuxCpuinfo('')).toBeUndefined()
    expect(parseLinuxCpuinfo('model name\t: x\n')).toBeUndefined()
  })

  it('reads the PCI vendor bytes to their vendors', () => {
    expect(pciVendorFromId('0x8086\n')).toBe('intel')
    expect(pciVendorFromId('0x10de')).toBe('nvidia')
    expect(pciVendorFromId('0x1002')).toBe('amd')
    expect(pciVendorFromId('0x1234')).toBe('unknown')
  })

  it('parses the nvidia-smi CUDA line and refuses a moved format', async () => {
    const gpus = parseNvidiaSmi(await helper('nvidia-smi-cuda.csv'))
    expect(gpus).toHaveLength(1)
    expect(gpus?.[0]?.name).toBe('NVIDIA GeForce GTX 1080 Ti')
    expect(gpus?.[0]?.driverVersion).toBe('456.71')
    expect(gpus?.[0]?.vramBytes).toBe(11_264 * 1024 * 1024)
    expect(parseNvidiaSmi('')).toBeUndefined()
    expect(parseNvidiaSmi('only, two\n')).toBeUndefined()
    expect(parseNvidiaSmi('name, driver, lots\n')).toBeUndefined()
  })

  it('parses sysctl leaf7, CIM video and ollama binary version', async () => {
    expect(parseSysctlFeatures(await helper('sysctl-leaf7.txt'))).toEqual(['avx2', 'avx512'])
    expect(parseSysctlFeatures('machdep.cpu.foo: 1\n')).toBeUndefined()
    const controllers = parseCimVideo(await helper('cim-video.json'))
    expect(controllers).toEqual([
      { name: 'NVIDIA GeForce GTX 1080 Ti', driverVersion: '31.0.15.4671' },
    ])
    expect(parseCimVideo('nope')).toBeUndefined()
    expect(parseCimVideo('[]')).toBeUndefined()
    expect(parseOllamaBinaryVersion(await helper('ollama-version-stdout.txt'))).toBe('0.35.1')
    expect(parseOllamaBinaryVersion('ollama something')).toBeUndefined()
  })

  it("parses Ollama wire bodies from M98's captures", async () => {
    // The documented /api/version shape with M98's captured version.
    expect(parseOllamaVersion(JSON.stringify({ version: '0.35.1' }))).toBe('0.35.1')
    expect(parseOllamaVersion('{}')).toBeUndefined()
    const systemone = JSON.parse(
      await readFile(
        path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          'fixtures',
          'localJudgeSystemOneCapture.json',
        ),
        'utf8',
      ),
      // The committed capture's envelope; tags and health parse below.
    ) as { tags: unknown; health: unknown }
    const tags = parseOllamaTags(JSON.stringify(systemone.tags))
    expect(tags?.[0]).toEqual({
      name: 'mxbai-embed-large:latest',
      digest: '468836162de7f81e041c43663fedbbba921dcea9b9fefea135685a39b2d83dd8',
    })
    const ps = parseOllamaPs(JSON.stringify(systemone.health))
    expect(ps?.[0]).toEqual({
      name: 'tev1:4b',
      digest: '9b5bb969e46c4b776826d6f2d401e22893205693f172653af6254897255025b8',
      contextLength: 2050,
    })
    expect(parseOllamaTags('[]')).toBeUndefined()
    expect(parseOllamaPs('{"models":[]}')).toEqual([])
  })

  it('parses OLLAMA_HOST and keeps the loopback default otherwise', () => {
    expect(parseOllamaHost('127.0.0.1:11434')).toEqual({ host: '127.0.0.1', port: 11_434 })
    // Explicit schemes (https here; http shares the branch) and paths.
    expect(parseOllamaHost('https://ollama.lan:80/v1')).toEqual({ host: 'ollama.lan', port: 80 })
    expect(parseOllamaHost('ollama.lan')).toEqual({ host: 'ollama.lan', port: 11_434 })
    expect(parseOllamaHost('')).toBeUndefined()
    expect(parseOllamaHost('h:99999')).toBeUndefined()
    expect(parseOllamaHost('h:0')).toBeUndefined()
    expect(parseOllamaHost('ftp://h:21')).toBeUndefined()
  })

  it('names absolute nvidia-smi candidates per platform, never a search', () => {
    expect(nvidiaSmiCandidates('linux', undefined, undefined)).toEqual([
      '/usr/bin/nvidia-smi',
      '/usr/local/bin/nvidia-smi',
    ])
    expect(nvidiaSmiCandidates('darwin', undefined, undefined)).toEqual([])
    expect(
      nvidiaSmiCandidates('win32', String.raw`C:\Windows`, String.raw`C:\Program Files`),
    ).toEqual([
      String.raw`C:\Windows\System32\nvidia-smi.exe`,
      String.raw`C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe`,
    ])
    expect(nvidiaSmiCandidates('win32', undefined, undefined)).toEqual([])
    expect(nvidiaSmiCandidates('win32', 'relative', undefined)).toEqual([])
  })

  it('finds executables on a scratch PATH and skips relative entries', async () => {
    const bin = path.join(scratch, 'bin')
    await mkdir(bin, { recursive: true })
    const target = path.join(bin, 'rlm125-probe-target')
    await writeFile(target, '#!/bin/sh\necho hi\n')
    await chmod(target, 0o755)
    const ghost = path.join(bin, 'rlm125-probe-ghost')
    await writeFile(ghost, 'not executable')
    await chmod(ghost, 0o644)
    const pathValue = ['relative-dir', bin].join(path.delimiter)
    expect(await findOnPath(['rlm125-probe-target'], pathValue)).toBe(target)
    expect(await findOnPath(['rlm125-probe-ghost'], pathValue)).toBeUndefined()
    expect(await findOnPath(['rlm125-probe-target'], '')).toBeUndefined()
    expect(await findOnPath(['rlm125-probe-target'], undefined)).toBeUndefined()
  })

  it('runs real tools with their own failure reasons', async () => {
    const version = await runProbe(process.execPath, ['--version'])
    expect(version.status).toBe('ok')
    if (version.status !== 'ok') return
    expect(version.text.startsWith('v')).toBe(true)
    expect(await runProbe('/nonexistent-rlm125-tool', [])).toEqual({ status: 'absent' })
    expect(await runProbe(process.execPath, ['--no-such-flag-rlm125'])).toEqual({
      status: 'failed',
    })
    expect(await runProbe(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], 100)).toEqual({
      status: 'timeout',
    })
    expect(
      await runProbe(process.execPath, ['-e', 'console.log("x".repeat(10000))'], 10_000, 100),
    ).toEqual({ status: 'too-big' })
  })

  it.skipIf(!isLinux)("walks this rig's DRM tree to its Intel card", async () => {
    const cards = await listDrmCards()
    for (const card of cards) {
      expect(card).toMatch(/^card\d+$/)
    }
    if (cards.length === 0) return
    const vendor = await readPciVendor('/sys', cards[0] ?? '')
    if (vendor !== undefined) {
      expect(['nvidia', 'amd', 'intel', 'unknown']).toContain(pciVendorFromId(vendor))
    }
    expect(await listDrmCards(path.join(scratch, 'no-such-sys'))).toEqual([])
    expect(await readPciVendor(scratch, 'card0')).toBeUndefined()
  })

  it.skipIf(!isLinux || isSmiPresent)(
    'reports an NVIDIA card without smi as CPU only',
    async () => {
      // The vendor byte is PCI-SIG's NVIDIA assignment; smi is really absent.
      const root = path.join(scratch, 'sys-nvidia')
      await mkdir(path.join(root, 'class', 'drm', 'card0', 'device'), { recursive: true })
      await writeFile(path.join(root, 'class', 'drm', 'card0', 'device', 'vendor'), '0x10de\n')
      const gpu = await probeGpu('linux', undefined, root)
      expect(gpu).toEqual({
        vendor: 'nvidia',
        backend: 'cpu',
        reason: 'an NVIDIA card is present but nvidia-smi is missing: CPU only',
      })
      const empty = await probeGpu('linux', undefined, path.join(scratch, 'sys-empty'))
      expect(empty).toEqual({
        vendor: 'unknown',
        backend: 'cpu',
        reason: 'no GPU reading: CPU only',
      })
    },
  )

  it("reports this machine's GPU honestly on any platform", async () => {
    const gpu = await probeGpu()
    expect(['nvidia', 'amd', 'intel', 'apple', 'unknown', 'none']).toContain(gpu.vendor)
    expect(['cuda', 'rocm', 'metal', 'cpu']).toContain(gpu.backend)
    expect(gpu.reason.length).toBeGreaterThan(0)
    if (gpu.backend === 'cuda') {
      expect(gpu.vendor).toBe('nvidia')
      expect(gpu.vramBytes ?? 0).toBeGreaterThan(0)
      expect(gpu.model?.length ?? 0).toBeGreaterThan(0)
    }
    if (gpu.vendor === 'intel') expect(gpu.backend).toBe('cpu')
  })

  it('answers unknown platforms and useless roots as CPU only', async () => {
    expect(await probeGpu('freebsd')).toEqual({
      vendor: 'unknown',
      backend: 'cpu',
      reason: 'no GPU reading: CPU only',
    })
    expect(await probeGpu('win32', undefined)).toEqual({
      vendor: 'unknown',
      backend: 'cpu',
      reason: 'no GPU reading: CPU only',
    })
    expect(await probeGpu('win32', String.raw`C:\Windows`)).toEqual({
      vendor: 'unknown',
      backend: 'cpu',
      reason: 'no GPU reading: CPU only',
    })
    const darwin = await probeGpu('darwin')
    if (process.arch === 'arm64') {
      expect(darwin.vendor).toBe('apple')
      expect(darwin.backend).toBe('metal')
    } else {
      expect(darwin).toEqual({
        vendor: 'unknown',
        backend: 'cpu',
        reason: 'discrete VRAM is unreadable on this Intel Mac: CPU only',
      })
    }
  })

  it("reads this machine's CPU with portable promises", async () => {
    const cpu = await probeCpu()
    expect(cpu.model.length).toBeGreaterThan(0)
    expect(cpu.cores).toBeGreaterThanOrEqual(1)
    for (const feature of cpu.features) {
      expect(['neon', 'avx2', 'avx512']).toContain(feature)
    }
  })

  it.skipIf(!isX64)('reads the recorded cpuinfo deterministically on x64', async () => {
    const cpu = await probeCpu('linux', path.join(helperRoot, 'cpuinfo-linuxlt.txt'))
    expect(cpu).toEqual({
      model: 'Intel(R) Core(TM) i7-10510U CPU @ 1.80GHz',
      cores: 8,
      features: ['avx2'],
    })
    // A missing cpuinfo falls back to the observed CPU, never throws.
    const fallback = await probeCpu('linux', path.join(scratch, 'no-such-cpuinfo'))
    expect(fallback.model.length).toBeGreaterThan(0)
    expect(fallback.features).toEqual([])
  })

  it('measures free disk, walking up past missing folders', () => {
    const here = probeDiskFree('.')
    expect(here ?? 0).toBeGreaterThan(0)
    const missing = probeDiskFree(path.join(scratch, 'a', 'b', 'c'))
    expect(missing ?? 0).toBeGreaterThan(0)
  })

  it('reports no Ollama on a loopback port nothing answers', async () => {
    const ollama = await probeOllama({ PATH: '', OLLAMA_HOST: '127.0.0.1:1' })
    expect(ollama).toEqual({ installed: false, running: false })
    const live = await probeOllama()
    expect(typeof live.installed).toBe('boolean')
    expect(typeof live.running).toBe('boolean')
    if (live.running) expect(live.version?.length ?? 0).toBeGreaterThan(0)
  })

  it('benchmarks within its deadline and reports an unmapped rate', async () => {
    const started = Date.now()
    const result = await runCpuBenchmark(150)
    expect(result.kind).toBe('unmapped')
    expect(result.iterations).toBeGreaterThan(0)
    expect(result.elapsedMs).toBeGreaterThanOrEqual(140)
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(result.ratePerSec).toBeGreaterThan(0)
  })

  it('scans this machine with sane portable readings', async () => {
    const summary = await scanHardware({ installPath: path.join(scratch, 'judge') })
    expect(summary.os).toBe(process.platform)
    expect(summary.arch).toBe(process.arch)
    expect(summary.osVersion.length).toBeGreaterThan(0)
    expect(summary.ramBytes).toBeGreaterThan(0)
    expect(summary.freeRamBytes).toBeGreaterThanOrEqual(0)
    expect(summary.cpu.model.length).toBeGreaterThan(0)
    expect(summary.cpu.cores).toBeGreaterThanOrEqual(1)
    expect(summary.gpu.reason.length).toBeGreaterThan(0)
    if (summary.diskFreeBytes !== undefined) expect(summary.diskFreeBytes).toBeGreaterThan(0)
    expect(summary.installPath).toBe(path.join(scratch, 'judge'))
    expect(typeof summary.ollama.installed).toBe('boolean')
    expect(summary.benchmark).toBeUndefined()
    const withBench = await scanHardware({
      installPath: path.join(scratch, 'judge'),
      runBenchmark: true,
      benchmarkMs: 150,
    })
    expect(withBench.benchmark?.kind).toBe('unmapped')
    expect(withBench.benchmark?.iterations ?? 0).toBeGreaterThan(0)
  })

  it('fingerprints the hardware stably and blind to software', async () => {
    const summary: HardwareSummary = await scanHardware({
      installPath: path.join(scratch, 'judge'),
    })
    const first = hardwareFingerprint(summary)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(hardwareFingerprint(summary)).toBe(first)
    expect(hardwareFingerprint({ ...summary, gpu: { ...summary.gpu, backend: 'cuda' } })).not.toBe(
      first,
    )
    expect(hardwareFingerprint({ ...summary, installPath: '/elsewhere' })).toBe(first)
    expect(
      hardwareFingerprint({
        ...summary,
        ollama: { installed: true, running: true, version: '9.9.9' },
      }),
    ).toBe(first)
  })
})
