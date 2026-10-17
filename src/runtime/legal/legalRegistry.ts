// The optional public-registry reader (M97 lane R, PLAN.md D76): enrichment
// for license metadata the offline scan could not see. OFF unless the
// command's `--registry` flag enables it; without the flag this module is
// never called and no request leaves the machine (a spy test pins that).
//
// Bounded by named constants: only LEGAL_REGISTRY_HOSTS over HTTPS with no
// credentials, at most LEGAL_REGISTRY_MAX_QUERIES requests of one
// package@version each, each response cut at
// LEGAL_REGISTRY_RESPONSE_MAX_BYTES within LEGAL_REGISTRY_TIMEOUT_MS. Every
// query is disclosed in the report (hosts, exact URLs, bytes); anything not
// answered stays unknown, never guessed.
//
// Parsers are written from live captures (lane R, 2026-10-04): npm's version
// document `GET https://registry.npmjs.org/<name>/<version>` carries
// `license` as a string or a legacy `{type}` object (a missing package
// answers 404 `"Not Found"`); PyPI's `GET
// https://pypi.org/pypi/<name>/<version>/json` carries
// `info.license_expression` with `info.license` beside it (a missing package
// answers 404 `{"message": "Not Found"}`). A license-shaped string past the
// contract's identifier bound is refused instead of quoted.

import * as z from 'zod/mini'
import { fill } from '../../shared/l10n/text'
import { legalScanResultSchema, type LegalScanResult } from '../../shared/legal'
import type { LegalScanHandle } from '../../shared/legalScanEntry'
import {
  HTTP_STATUS,
  UI_TEXT,
  LEGAL_FINDINGS_MAX,
  LEGAL_INCOMPLETE_MAX,
  LEGAL_FINDING_ID_MAX_CHARS,
  LEGAL_REGISTRY_HOSTS,
  LEGAL_REGISTRY_MAX_QUERIES,
  LEGAL_REGISTRY_NAME_MAX_CHARS,
  LEGAL_REGISTRY_RESPONSE_MAX_BYTES,
  LEGAL_REGISTRY_TIMEOUT_MS,
  LEGAL_VERSION_MAX_CHARS,
  type LegalRegistryEcosystem,
} from '../../shared/constants'

import type { LegalRegistryTarget } from '../../shared/legalScanEntry'
export type { LegalRegistryTarget } from '../../shared/legalScanEntry'

export type LegalRegistryStatus = 'found' | 'unknown' | 'refused' | 'error'

export interface LegalRegistryLicense {
  readonly target: LegalRegistryTarget
  readonly status: LegalRegistryStatus
  /** The expression the registry stated, or undefined when it stated none. */
  readonly license: string | undefined
  readonly httpStatus: number | undefined
  readonly bytes: number
}

export interface LegalRegistrySkipped {
  readonly target: LegalRegistryTarget
  /** A machine-readable code, not a sentence (`over-limit`, `bad-name`, …). */
  readonly reason: string
}

/** The disclosure the report carries: every query, so the user sees what left. */
export interface LegalRegistryReport {
  readonly enabled: boolean
  readonly hosts: readonly string[]
  /** The exact URLs requested, in order. */
  readonly queried: readonly string[]
  readonly licenses: readonly LegalRegistryLicense[]
  readonly skipped: readonly LegalRegistrySkipped[]
  readonly isTruncated: boolean
  readonly bytesReceived: number
}

const NPM_NAME_PATTERN = /^(?:@[a-z0-9-~][a-z0-9-._~]*[/])?[a-z0-9-~][a-z0-9-._~]*$/
const SIMPLE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/
const VERSION_PATTERN = /^[A-Za-z0-9.+_-]+$/

/** A scanner-provided target is fit to encode into a URL, or it is skipped. */
export function isRegistryTarget(value: unknown): value is LegalRegistryTarget {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('ecosystem' in value) ||
    !('name' in value) ||
    !('version' in value) ||
    typeof value.name !== 'string' ||
    typeof value.version !== 'string'
  ) {
    return false
  }
  const { ecosystem, name, version } = value
  if (ecosystem !== 'npm' && ecosystem !== 'pypi') return false
  if (
    name.length === 0 ||
    name.length > LEGAL_REGISTRY_NAME_MAX_CHARS ||
    version.length === 0 ||
    version.length > LEGAL_VERSION_MAX_CHARS ||
    !VERSION_PATTERN.test(version)
  ) {
    return false
  }
  return ecosystem === 'npm' ? NPM_NAME_PATTERN.test(name) : SIMPLE_NAME_PATTERN.test(name)
}

export interface LegalRegistryHosts {
  readonly npm: string
  readonly pypi: string
}

function npmPath(name: string, version: string): string {
  const slash = name.indexOf('/')
  // A scoped name keeps its bare `@` with an encoded slash (`@types%2Fnode`,
  // as captured live); encoding the `@` itself answers 404 on the registry.
  const encoded =
    slash === -1
      ? encodeURIComponent(name)
      : `@${encodeURIComponent(name.slice(1, slash))}%2F${encodeURIComponent(name.slice(slash + 1))}`
  return `/${encoded}/${encodeURIComponent(version)}`
}

function registryUrl(target: LegalRegistryTarget, hosts: LegalRegistryHosts): string | undefined {
  // Tests point the reader at loopback fakes over plain HTTP; production
  // hosts stay HTTPS. The hostname still has to be exactly the configured
  // one: no redirects are followed to it, no other host is ever built.
  const base = target.ecosystem === 'npm' ? hosts.npm : hosts.pypi
  const bare = base.split(':', 2)[0] ?? base
  const isLoopback = bare === 'localhost' || bare === '127.0.0.1'
  const scheme = isLoopback ? 'http' : 'https'
  const raw =
    target.ecosystem === 'npm'
      ? `${scheme}://${base}${npmPath(target.name, target.version)}`
      : `${scheme}://${base}/pypi/${encodeURIComponent(target.name)}/${encodeURIComponent(target.version)}/json`
  try {
    const url = new URL(raw)
    if (url.host !== base) return undefined
    if (url.protocol === 'https:') return url.href
    return isLoopback && url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}

const npmVersionSchema = z.looseObject({ license: z.optional(z.string()) })
const pypiInfoSchema = z.looseObject({
  license_expression: z.optional(z.nullable(z.string())),
  license: z.optional(z.nullable(z.string())),
})
const pypiSchema = z.looseObject({ info: pypiInfoSchema })

function pickLicense(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  // A license-shaped identifier only: whole license texts and anything past
  // the contract's bound stay unknown instead of becoming a quoted fact.
  if (trimmed.length === 0 || trimmed.length > LEGAL_FINDING_ID_MAX_CHARS) return undefined
  // A license-shaped identifier only: whole license texts and anything past
  // the contract's bound stay unknown instead of becoming a quoted fact.
  return trimmed.length === 0 ? undefined : trimmed
}

function licenseOf(ecosystem: LegalRegistryEcosystem, body: unknown): string | undefined {
  if (ecosystem === 'npm') {
    return pickLicense(npmVersionSchema.parse(body).license)
  }
  const parsed = pypiSchema.parse(body)
  return (
    pickLicense(parsed.info.license_expression ?? undefined) ??
    pickLicense(parsed.info.license ?? undefined)
  )
}

async function readBoundedBody(response: Response): Promise<{
  text: string
  bytes: number
  isTruncated: boolean
}> {
  const stream = response.body
  if (stream === null) return { text: '', bytes: 0, isTruncated: false }
  const reader: ReadableStreamDefaultReader<Uint8Array> = stream.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  for (;;) {
    const part = await reader.read()
    if (part.done) break
    bytes += part.value.byteLength
    if (bytes > LEGAL_REGISTRY_RESPONSE_MAX_BYTES) {
      try {
        await reader.cancel()
      } catch {
        // The registry already went away; the truncation stands on its own.
      }
      return { text: '', bytes, isTruncated: true }
    }
    chunks.push(part.value)
  }
  const merged = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { text: new TextDecoder().decode(merged), bytes, isTruncated: false }
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // The registry already went away; the status stands on its own.
  }
}

async function queryOne(
  target: LegalRegistryTarget,
  url: string,
  input: { fetch: typeof fetch; signal: AbortSignal },
): Promise<LegalRegistryLicense> {
  // No headers, no credentials: the registries' public documents need none.
  // The deadline arrives with the signal: each attempt owns one (see above).
  const response = await input.fetch(url, { signal: input.signal, redirect: 'error' })
  const { status } = response
  if (status === HTTP_STATUS.notFound) {
    await discardBody(response)
    return { target, status: 'unknown', license: undefined, httpStatus: status, bytes: 0 }
  }
  if (status !== HTTP_STATUS.ok) {
    await discardBody(response)
    return { target, status: 'error', license: undefined, httpStatus: status, bytes: 0 }
  }
  const { text, bytes, isTruncated } = await readBoundedBody(response)
  if (isTruncated) {
    return { target, status: 'refused', license: undefined, httpStatus: status, bytes }
  }
  try {
    const body: unknown = JSON.parse(text)
    const license = licenseOf(target.ecosystem, body)
    return {
      target,
      status: license === undefined ? 'unknown' : 'found',
      license,
      httpStatus: status,
      bytes,
    }
  } catch {
    return { target, status: 'error', license: undefined, httpStatus: status, bytes }
  }
}

/**
 * Enriches at most LEGAL_REGISTRY_MAX_QUERIES targets, one request each, in
 * order. A failed request marks its own target; it never fails the scan's
 * facts. Call only with the user's `--registry` consent.
 */
export async function enrichFromRegistries(input: {
  readonly targets: readonly LegalRegistryTarget[]
  readonly fetch: typeof fetch
  readonly signal?: AbortSignal | undefined
  /** Tests point this at loopback fakes; production always uses the constants. */
  readonly hosts?: LegalRegistryHosts | undefined
}): Promise<LegalRegistryReport> {
  const hosts: LegalRegistryHosts = input.hosts ?? LEGAL_REGISTRY_HOSTS
  const seen = new Map<string, LegalRegistryTarget>()
  for (const target of input.targets) {
    const key = `${target.ecosystem} ${target.name} ${target.version}` // names/versions never hold a space, so keys cannot collide.
    if (!seen.has(key)) seen.set(key, target)
  }
  const disclosed: readonly string[] = Object.values(hosts)
  const queried: string[] = []
  const licenses: LegalRegistryLicense[] = []
  const skipped: LegalRegistrySkipped[] = []
  let bytesReceived = 0
  let isTruncated = false
  for (const target of seen.values()) {
    input.signal?.throwIfAborted()
    if (queried.length >= LEGAL_REGISTRY_MAX_QUERIES) {
      isTruncated = true
      skipped.push({ target, reason: 'over-limit' })
      continue
    }
    const url = registryUrl(target, hosts)
    if (url === undefined) {
      skipped.push({ target, reason: 'bad-url' })
      continue
    }
    queried.push(url)
    // Each attempt owns its deadline: a hanging registry marks its own
    // target and the rest still enrich. Only the caller's abort stops all.
    const attempt =
      input.signal === undefined
        ? AbortSignal.timeout(LEGAL_REGISTRY_TIMEOUT_MS)
        : AbortSignal.any([input.signal, AbortSignal.timeout(LEGAL_REGISTRY_TIMEOUT_MS)])
    try {
      const license = await queryOne(target, url, { fetch: input.fetch, signal: attempt })
      bytesReceived += license.bytes
      licenses.push(license)
    } catch (error: unknown) {
      if (input.signal?.aborted === true) throw error
      licenses.push({
        target,
        status: 'error',
        license: undefined,
        httpStatus: undefined,
        bytes: 0,
      })
    }
  }
  return { enabled: true, hosts: disclosed, queried, licenses, skipped, isTruncated, bytesReceived }
}

/** Interactive registry enrichment: disclosure precedes the first request. */
export async function enrichInteractiveLegalScan(
  handle: LegalScanHandle,
  deps: {
    readonly isOn: () => boolean
    readonly isNoticed: (host: string) => boolean
    readonly notice: (hosts: readonly string[]) => Promise<boolean>
    readonly markNoticed: (hosts: readonly string[]) => Promise<void>
    readonly fetch: typeof fetch
    readonly signal?: AbortSignal
  },
): Promise<LegalScanResult> {
  const targets = handle.registryTargets.filter(isRegistryTarget)
  if (targets.length === 0) return handle.result
  const offline = () =>
    legalScanResultSchema.parse({
      ...handle.result,
      incompleteChecks: [
        UI_TEXT.legalRegistryOfflineUnknown,
        ...handle.result.incompleteChecks,
      ].slice(0, LEGAL_INCOMPLETE_MAX),
    })
  if (!deps.isOn()) return offline()
  const hosts = [...new Set(targets.map((target) => LEGAL_REGISTRY_HOSTS[target.ecosystem]))]
  const unseen = hosts.filter((host) => !deps.isNoticed(host))
  if (unseen.length > 0) {
    if (!(await deps.notice(unseen))) return offline()
    deps.signal?.throwIfAborted()
    if (!deps.isOn()) return offline()
    await deps.markNoticed(unseen)
  }
  deps.signal?.throwIfAborted()
  if (!deps.isOn()) return offline()
  const report = await enrichFromRegistries({ targets, fetch: deps.fetch, signal: deps.signal })
  deps.signal?.throwIfAborted()
  const facts = report.licenses.flatMap((entry, index) =>
    entry.license === undefined
      ? []
      : [
          {
            id: `registry/1/${String(index + 1)}`,
            category: 'dependencyLicense',
            severity: 'advice',
            packageName: entry.target.name,
            packageVersion: entry.target.version,
            licenseExpression: entry.license,
            evidenceSource: LEGAL_REGISTRY_HOSTS[entry.target.ecosystem],
            confidence: 1,
            explanation: fill(UI_TEXT.legalRegistryFact, {
              name: entry.target.name,
              version: entry.target.version,
              license: entry.license,
            }),
            recommendation: UI_TEXT.legalRegistryRecommendation,
            fixable: false,
          },
        ],
  )
  return legalScanResultSchema.parse({
    ...handle.result,
    findings: [...handle.result.findings, ...facts].slice(0, LEGAL_FINDINGS_MAX),
    incompleteChecks: [UI_TEXT.legalRegistryMetadataOnly, ...handle.result.incompleteChecks].slice(
      0,
      LEGAL_INCOMPLETE_MAX,
    ),
  })
}
