// M125 lane H (D107): pure hardware-output parsers. Every parser reads
// only what its probe needs and fails closed to undefined: a surprising
// format is unknown hardware, never a guessed reading. Provenance per
// parser: the recorded linuxlt captures, M98's Ollama wire captures,
// the PCI-SIG vendor list, or a documented tool format (marked; a rig
// capture replaces it when one lands — PLAN.md §3).
import * as z from 'zod/mini'
import { LOCAL_JUDGE_MAX_MODELS, OLLAMA_DEFAULT_PORT } from '../../../shared/constants'

/** PCI-SIG vendor IDs for the GPU vendors the scan names. */
const PCI_VENDORS: Readonly<Record<string, 'nvidia' | 'amd' | 'intel'>> = {
  '0x10de': 'nvidia',
  '0x1002': 'amd',
  '0x8086': 'intel',
}

/** A /sys vendor file's bytes to its vendor; anything else is unknown. */
export function pciVendorFromId(text: string): 'nvidia' | 'amd' | 'intel' | 'unknown' {
  return PCI_VENDORS[text.trim().toLowerCase()] ?? 'unknown'
}

const X86_FEATURES = ['avx2', 'avx512'] as const

/**
x86 feature tokens from one flags line (/proc/cpuinfo, sysctl leaf7).
Exact tokens only: AVX2 is one token, and any AVX-512 token counts.
*/
export function cpuFeaturesFromFlags(flagsLine: string): readonly string[] {
  const tokens = new Set(flagsLine.trim().split(/\s+/))
  const features: string[] = []
  if (tokens.has('avx2') || tokens.has('AVX2')) features.push(X86_FEATURES[0])
  for (const token of tokens) {
    if (/^avx512/i.test(token)) {
      features.push(X86_FEATURES[1])
      break
    }
  }
  return features
}

export interface LinuxCpuinfo {
  readonly model: string
  readonly cores: number
  readonly features: readonly string[]
}

/** /proc/cpuinfo: the first model name, the processor count, the x86 features. */
export function parseLinuxCpuinfo(text: string): LinuxCpuinfo | undefined {
  let model: string | undefined
  let cores = 0
  let flags = ''
  for (const line of text.split('\n')) {
    if (line.startsWith('model name')) {
      model ??= line.split(':', 2)[1]?.trim()
    } else if (line.startsWith('processor')) {
      cores += 1
    } else if (flags === '' && line.startsWith('flags')) {
      flags = line.split(':', 2)[1] ?? ''
    }
  }
  return model === undefined || model === '' || cores === 0
    ? undefined
    : { model, cores, features: cpuFeaturesFromFlags(flags) }
}

/**
sysctl's leaf7 line (darwin/x64): "machdep.cpu.leaf7_features: ...".
Marked sample until a Mac capture lands (PLAN.md §3).
*/
export function parseSysctlFeatures(text: string): readonly string[] | undefined {
  for (const line of text.split('\n')) {
    const [key, value] = line.split(':', 2)
    if (value !== undefined && key?.trim() === 'machdep.cpu.leaf7_features') {
      return cpuFeaturesFromFlags(value)
    }
  }
  return undefined
}

export interface NvidiaGpu {
  readonly name: string
  readonly driverVersion: string
  readonly vramBytes: number
}

const BYTES_PER_KIB = 1024
const KIB_PER_MIB = 1024
const MIB = BYTES_PER_KIB * KIB_PER_MIB
const NVIDIA_SMI_FIELD_COUNT = 3

/**
nvidia-smi --query-gpu=name,driver_version,memory.total
--format=csv,noheader,nounits: one "name, driver, MiB" line per GPU.
Marked sample until a CUDA rig capture lands (PLAN.md §3); the flags
and the line discipline are M107's live sampler use. One surprising
line fails the whole answer: the format moved, so nothing parses.
*/
export function parseNvidiaSmi(text: string): readonly NvidiaGpu[] | undefined {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  if (lines.length === 0) return undefined
  const gpus: NvidiaGpu[] = []
  for (const line of lines) {
    const fields = line.split(',').map((field) => field.trim())
    if (fields.length !== NVIDIA_SMI_FIELD_COUNT) return undefined
    const [name, driverVersion, memMib] = fields
    if (name === undefined || name === '') return undefined
    if (driverVersion === undefined || driverVersion === '') return undefined
    // nounits prints a bare count, "11178" or "11178.00".
    if (memMib === undefined || !/^\d+(?:\.\d+)?$/.test(memMib)) return undefined
    gpus.push({ name, driverVersion, vramBytes: Math.round(Number(memMib) * MIB) })
  }
  return gpus
}

export interface CimVideoController {
  readonly name: string
  readonly driverVersion: string
}

/**
Win32_VideoController as JSON (Name, DriverVersion): the vendor and
model only. AdapterRAM is never trusted — the uint32 wraps above
4 GiB, so a wrapped value reads as a plausible small one. NVIDIA
VRAM comes from nvidia-smi instead. Marked sample until a Windows
capture lands (PLAN.md §3).
*/
export function parseCimVideo(text: string): readonly CimVideoController[] | undefined {
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
  const controllers = z
    .array(
      z.looseObject({
        Name: z.string(),
        DriverVersion: z.string(),
      }),
    )
    .safeParse(input)
  if (!controllers.success || controllers.data.length === 0) return undefined
  return controllers.data.map((controller) => ({
    name: controller.Name,
    driverVersion: controller.DriverVersion,
  }))
}

const versionSchema = z.looseObject({ version: z.string().check(z.minLength(1)) })

/**
/api/version's body. Shape from M98's capture
(test/unit/fixtures/localJudgeCapture.json: "version": "0.35.1").
*/
export function parseOllamaVersion(text: string): string | undefined {
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
  const parsed = versionSchema.safeParse(input)
  return parsed.success ? parsed.data.version : undefined
}

/** `ollama --version` stdout: any X.Y.Z it names. Marked sample (PLAN.md §3). */
export function parseOllamaBinaryVersion(text: string): string | undefined {
  return /(\d+\.\d+\.\d+)/.exec(text)?.[1]
}

const digestSchema = z.string().check(z.regex(/^[a-f\d]{64}$/))
const tagsSchema = z.looseObject({
  models: z
    .array(z.looseObject({ name: z.string().check(z.minLength(1)), digest: digestSchema }))
    .check(z.maxLength(LOCAL_JUDGE_MAX_MODELS)),
})

export interface OllamaTag {
  readonly name: string
  readonly digest: string
}

/**
/api/tags' body. Shape from M98's capture
(test/unit/fixtures/localJudgeSystemOneCapture.json: tags).
*/
export function parseOllamaTags(text: string): readonly OllamaTag[] | undefined {
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
  const parsed = tagsSchema.safeParse(input)
  return parsed.success
    ? parsed.data.models.map((model) => ({ name: model.name, digest: model.digest }))
    : undefined
}

const psSchema = z.looseObject({
  models: z
    .array(
      z.looseObject({
        name: z.string().check(z.minLength(1)),
        digest: digestSchema,
        context_length: z.int().check(z.positive()),
      }),
    )
    .check(z.maxLength(LOCAL_JUDGE_MAX_MODELS)),
})

export interface OllamaLoadedModel {
  readonly name: string
  readonly digest: string
  readonly contextLength: number
}

/**
/api/ps' body: the loaded models with their digests and context
windows. Shape from M98's capture
(test/unit/fixtures/localJudgeSystemOneCapture.json: health).
*/
export function parseOllamaPs(text: string): readonly OllamaLoadedModel[] | undefined {
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
  const parsed = psSchema.safeParse(input)
  if (!parsed.success) return undefined
  return parsed.data.models.map((model) => ({
    name: model.name,
    digest: model.digest,
    contextLength: model.context_length,
  }))
}

export interface OllamaHost {
  readonly host: string
  readonly port: number
}

/**
OLLAMA_HOST ("host:port", "http(s)://host:port"). Anything else is
undefined and the caller keeps the loopback default. The port is read
back from the input because the URL parser elides a default port
("h:80" would otherwise come back portless).
*/
export function parseOllamaHost(value: string): OllamaHost | undefined {
  const withScheme = value.includes('://') ? value : `http://${value}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch (error: unknown) {
    if (!(error instanceof TypeError)) throw error
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (url.hostname === '') return undefined
  const portText = /:(\d+)(?:\/|$)/.exec(withScheme)?.[1]
  const port = portText === undefined ? OLLAMA_DEFAULT_PORT : Number(portText)
  // The URL parser already refused out-of-range ports; only 0 remains.
  return port <= 0 ? undefined : { host: url.hostname, port }
}
