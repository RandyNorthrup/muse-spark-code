// D90.4's sandbox engine (M110b W1): containers through the engine's
// REST API on its unix socket — Rootless Podman first, Rootless Docker
// beside it. The adapter speaks the Docker-compatible surface both
// serve (Podman's compat socket), negotiates the API version from the
// daemon, and pins nothing else: runtimes come from the daemon's own
// list, constraints from the person's settings, images by digest in
// the ref. Request builders and response parsers are pure and tested
// against recorded daemon exchanges; the socket transport and the
// lifecycle around it are proven by drill on a real daemon. Every HTTP
// response parses through zod before use; unknown wire fields strip
// from the typed view while inspect keeps its raw for display.
import { existsSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import * as z from 'zod/mini'
import { HTTP_SUCCESS_MAX, HTTP_SUCCESS_MIN } from '../../../shared/constants'

/** Labels every sandbox carries: the node owns them, drills filter them. */
export const SANDBOX_LABEL_MANAGED = 'muse.node.sandbox'
export const SANDBOX_LABEL_WORKSPACE = 'muse.node.workspace'

/** The daemon's trimmed words in an error: codes, never full bodies. */
const ERROR_SNIPPET_MAX_CHARS = 200
/** The daemon's "already exists" for an idempotent create. */
const HTTP_STATUS_CONFLICT = 409

function isSuccessStatus(status: number): boolean {
  return status >= HTTP_SUCCESS_MIN && status <= HTTP_SUCCESS_MAX
}

/** A daemon's answer that refuses: status plus the daemon's trimmed words. */
export class EngineError extends Error {
  public constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message)
  }
}

/** Which engine answered: podman by its component name, else docker. */
export type EngineName = 'podman' | 'docker'

const versionSchema = z.looseObject({
  Version: z.string(),
  ApiVersion: z.string(),
  Os: z.string(),
  Arch: z.string(),
  Components: z.optional(z.array(z.looseObject({ Name: z.string() }))),
})

const runtimeMapSchema = z.record(z.string(), z.unknown())

const infoSchema = z.object({
  ServerVersion: z.string(),
  DefaultRuntime: z.optional(z.string()),
  Runtimes: z.optional(runtimeMapSchema),
})

const summarySchema = z.object({
  Id: z.string(),
  Names: z.array(z.string()),
  State: z.string(),
  Status: z.string(),
  Labels: z.record(z.string(), z.string()),
})
export type ContainerSummary = z.infer<typeof summarySchema>

const inspectSchema = z.object({
  Id: z.string(),
  Created: z.string(),
  State: z.object({
    Status: z.string(),
    Running: z.boolean(),
    ExitCode: z.number(),
    FinishedAt: z.string(),
  }),
  Config: z.object({ Labels: z.record(z.string(), z.string()) }),
  NetworkSettings: z.object({
    Networks: z.record(z.string(), z.object({ IPAddress: z.string(), Gateway: z.string() })),
  }),
})
export type ContainerInspect = z.infer<typeof inspectSchema>

const networkSchema = z.object({
  Id: z.string(),
  Name: z.string(),
  IPAM: z.object({ Config: z.array(z.object({ Subnet: z.string(), Gateway: z.string() })) }),
})
export type NetworkInspect = z.infer<typeof networkSchema>

const createdSchema = z.object({ Id: z.string() })

/** A connected daemon: its socket, version and name. */
export interface Engine {
  readonly socketPath: string
  readonly apiVersion: string
  readonly name: EngineName
  readonly serverVersion: string
}

export function enginePath(apiVersion: string, path: string): string {
  return `/v${apiVersion}${path}`
}

export function listQuery(label: string): string {
  return `?${new URLSearchParams({ all: 'true', filters: JSON.stringify({ label: [label] }) }).toString()}`
}

/** The runtimes the daemon offers, from its info. */
export function offeredRuntimes(info: unknown): readonly string[] {
  const parsed = infoSchema.safeParse(info)
  return !parsed.success || parsed.data.Runtimes === undefined
    ? []
    : Object.keys(parsed.data.Runtimes)
}

/**
Pick the sandbox runtime: `auto` takes the engine default (no runtime
field), anything else must be offered — a runtime the daemon lacks is
refused, never silently replaced (weaker isolation must never sneak
in).
*/
export function selectRuntime(
  offered: readonly string[],
  want: string,
  defaultRuntime?: string,
): string | undefined {
  if (want === 'auto') return undefined
  if (offered.includes(want)) return want
  if (defaultRuntime !== undefined && want === defaultRuntime) return undefined
  throw new Error(
    `runtime ${want} is not offered (offered: ${offered.length === 0 ? 'none' : offered.join(', ')})`,
  )
}

export function parseVersion(info: unknown): {
  apiVersion: string
  name: EngineName
  serverVersion: string
} {
  const parsed = versionSchema.parse(info)
  const components = parsed.Components ?? []
  const name: EngineName = components.some((component) =>
    component.Name.toLowerCase().includes('podman'),
  )
    ? 'podman'
    : 'docker'
  return { apiVersion: parsed.ApiVersion, name, serverVersion: parsed.Version }
}

export function parseSummaries(payload: unknown): ContainerSummary[] {
  return z.array(summarySchema).parse(payload)
}

export function parseInspect(payload: unknown): ContainerInspect {
  return inspectSchema.parse(payload)
}

export function parseNetwork(payload: unknown): NetworkInspect {
  return networkSchema.parse(payload)
}

/** The gateway the proxy binds for one workspace network. */
export function networkGateway(network: NetworkInspect): string | undefined {
  return network.IPAM.Config[0]?.Gateway
}

export interface SandboxCreate {
  readonly image: string
  readonly name?: string
  readonly command?: readonly string[]
  readonly env?: readonly string[]
  /** Host path, sandbox path; SELinux relabel appended for podman on SELinux. */
  readonly binds?: readonly { readonly host: string; readonly sandbox: string }[]
  readonly network?: string
  readonly runtime?: string
  readonly memoryBytes?: number
  readonly nanoCpus?: number
  readonly pidsLimit?: number
  readonly labels?: Readonly<Record<string, string>>
}

export function createBody(
  create: SandboxCreate,
  isSelinuxEnforcing: boolean,
  engine: EngineName,
): Record<string, unknown> {
  const binds = (create.binds ?? []).map((bind) => {
    const suffix = isSelinuxEnforcing && engine === 'podman' ? ':z' : ''
    return `${bind.host}:${bind.sandbox}:rw${suffix}`
  })
  return {
    Image: create.image,
    ...(create.command !== undefined && { Cmd: [...create.command] }),
    ...(create.env !== undefined && { Env: [...create.env] }),
    HostConfig: {
      ...(binds.length > 0 && { Binds: binds }),
      ...(create.memoryBytes !== undefined && { Memory: create.memoryBytes }),
      ...(create.nanoCpus !== undefined && { NanoCpus: create.nanoCpus }),
      ...(create.pidsLimit !== undefined && { PidsLimit: create.pidsLimit }),
    },
    ...(create.network !== undefined && {
      NetworkingConfig: { EndpointsConfig: { [create.network]: {} } },
    }),
    ...(create.runtime !== undefined && { Runtime: create.runtime }),
    Labels: { [SANDBOX_LABEL_MANAGED]: '1', ...create.labels },
  }
}

export function updateBody(update: {
  readonly memoryBytes?: number
  readonly nanoCpus?: number
}): Record<string, unknown> {
  return {
    ...(update.memoryBytes !== undefined && { Memory: update.memoryBytes }),
    ...(update.nanoCpus !== undefined && { NanoCpus: update.nanoCpus }),
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

/** SELinux enforcing on this host (the relabel decision reads it live). */
export function isSelinuxEnforcing(): boolean {
  try {
    return readFileSync('/sys/fs/selinux/enforce', 'utf8').trim() === '1'
  } catch (error: unknown) {
    if (isMissingFile(error)) return false
    throw error
  }
}

function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error ? String(error.code) : 'error'
}

async function rawRequest(
  socketPath: string,
  path: string,
  method: string,
  payload?: string,
): Promise<{ readonly status: number; readonly bytes: Buffer }> {
  return await new Promise((resolve, reject) => {
    const outgoing = request(
      {
        socketPath,
        path,
        method,
        headers: payload === undefined ? {} : { 'Content-Type': 'application/json' },
      },
      (incoming) => {
        const chunks: Buffer[] = []
        incoming.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        incoming.on('end', () => {
          resolve({ status: incoming.statusCode ?? 0, bytes: Buffer.concat(chunks) })
        })
      },
    )
    outgoing.on('error', (error: unknown) => {
      reject(new EngineError(`engine ${method} ${path}: ${errorCode(error)}`))
    })
    if (payload !== undefined) outgoing.write(payload)
    outgoing.end()
  })
}

async function engineRequest(
  engine: Engine,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const { status, bytes } = await rawRequest(
    engine.socketPath,
    enginePath(engine.apiVersion, path),
    method,
    body === undefined ? undefined : JSON.stringify(body),
  )
  const text = bytes.toString('utf8')
  if (!isSuccessStatus(status)) {
    throw new EngineError(
      `engine ${method} ${path}: ${String(status)} ${text.slice(0, ERROR_SNIPPET_MAX_CHARS)}`,
      status,
    )
  }
  if (text === '') return undefined
  try {
    return JSON.parse(text) as unknown
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      throw new EngineError(`engine ${method} ${path}: unparsable reply`, status)
    }
    throw error
  }
}

/**
Connect to the first engine socket that exists: explicit, the user's
podman socket, the system podman socket, then docker's. Unix sockets
only; TCP engines stay out (their TLS is another lane's threat
model).
*/
export function resolveSocketPath(explicit?: string): string | undefined {
  const runtimeDir = process.env['XDG_RUNTIME_DIR']
  const candidates = [
    explicit,
    runtimeDir === undefined ? undefined : `${runtimeDir}/podman/podman.sock`,
    '/run/podman/podman.sock',
    '/var/run/docker.sock',
  ]
  return candidates.find((candidate) => candidate !== undefined && existsSync(candidate))
}

export async function connectEngine(explicitSocket?: string): Promise<Engine> {
  const socketPath = resolveSocketPath(explicitSocket)
  if (socketPath === undefined) throw new Error('no engine socket: podman or docker is required')
  const versioned = await rawRequest(socketPath, '/version', 'GET')
  const versionText = versioned.bytes.toString('utf8')
  if (!isSuccessStatus(versioned.status)) {
    throw new EngineError(
      `engine GET /version: ${String(versioned.status)} ${versionText.slice(0, ERROR_SNIPPET_MAX_CHARS)}`,
      versioned.status,
    )
  }
  let raw: unknown
  try {
    raw = JSON.parse(versionText) as unknown
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      throw new EngineError('engine GET /version: unparsable reply', versioned.status)
    }
    throw error
  }
  const parsed = parseVersion(raw)
  return {
    socketPath,
    apiVersion: parsed.apiVersion,
    name: parsed.name,
    serverVersion: parsed.serverVersion,
  }
}

export async function engineInfo(engine: Engine): Promise<unknown> {
  return await engineRequest(engine, 'GET', '/info')
}

export async function listSandboxes(engine: Engine): Promise<ContainerSummary[]> {
  const raw = await engineRequest(
    engine,
    'GET',
    `/containers/json${listQuery(SANDBOX_LABEL_MANAGED)}`,
  )
  return parseSummaries(raw)
}

export async function createSandbox(engine: Engine, create: SandboxCreate): Promise<string> {
  const query =
    create.name === undefined ? '' : `?${new URLSearchParams({ name: create.name }).toString()}`
  const raw = await engineRequest(
    engine,
    'POST',
    `/containers/create${query}`,
    createBody(create, isSelinuxEnforcing(), engine.name),
  )
  return createdSchema.parse(raw).Id
}

export async function startSandbox(engine: Engine, id: string): Promise<void> {
  await engineRequest(engine, 'POST', `/containers/${id}/start`)
}

export async function stopSandbox(
  engine: Engine,
  id: string,
  timeoutSeconds: number,
): Promise<void> {
  await engineRequest(engine, 'POST', `/containers/${id}/stop?t=${String(timeoutSeconds)}`)
}

export async function removeSandbox(engine: Engine, id: string, isForced: boolean): Promise<void> {
  await engineRequest(engine, 'DELETE', `/containers/${id}?force=${isForced ? 'true' : 'false'}`)
}

export async function inspectSandbox(
  engine: Engine,
  id: string,
): Promise<{ readonly parsed: ContainerInspect; readonly raw: unknown }> {
  const raw = await engineRequest(engine, 'GET', `/containers/${id}/json`)
  return { parsed: parseInspect(raw), raw }
}

export async function updateSandbox(
  engine: Engine,
  id: string,
  update: { readonly memoryBytes?: number; readonly nanoCpus?: number },
): Promise<void> {
  await engineRequest(engine, 'POST', `/containers/${id}/update`, updateBody(update))
}

export async function ensureNetwork(engine: Engine, name: string): Promise<string> {
  try {
    const raw = await engineRequest(engine, 'POST', '/networks/create', {
      Name: name,
      Internal: true,
      Labels: { [SANDBOX_LABEL_MANAGED]: '1' },
    })
    return z.object({ Id: z.string() }).parse(raw).Id
  } catch (error: unknown) {
    if (error instanceof EngineError && error.status === HTTP_STATUS_CONFLICT) {
      const raw = await engineRequest(engine, 'GET', `/networks/${name}`)
      return parseNetwork(raw).Id
    }
    throw error
  }
}

export async function inspectNetwork(engine: Engine, id: string): Promise<NetworkInspect> {
  return parseNetwork(await engineRequest(engine, 'GET', `/networks/${id}`))
}

/** Pull the image, streaming progress; the digest rides the ref the caller pins. */
export async function pullImage(engine: Engine, image: string): Promise<void> {
  const pulled = await rawRequest(
    engine.socketPath,
    `${enginePath(engine.apiVersion, '/images/create')}?${new URLSearchParams({ fromImage: image }).toString()}`,
    'POST',
  )
  const text = pulled.bytes.toString('utf8')
  const status = pulled.status
  if (!isSuccessStatus(status)) {
    throw new EngineError(
      `engine pull ${image}: ${String(status)} ${text.slice(0, ERROR_SNIPPET_MAX_CHARS)}`,
      status,
    )
  }
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line) as unknown
    } catch (error: unknown) {
      if (error instanceof SyntaxError) {
        throw new EngineError(`engine pull ${image}: unparsable progress`, status)
      }
      throw error
    }
    const progress = z.object({ error: z.optional(z.string()) }).safeParse(parsed)
    if (progress.success && progress.data.error !== undefined) {
      throw new EngineError(
        `engine pull ${image}: ${progress.data.error.slice(0, ERROR_SNIPPET_MAX_CHARS)}`,
        status,
      )
    }
  }
}

/** What cleanup reaped and what it kept, with the reason for each kept. */
export interface SandboxCleanup {
  readonly removed: readonly string[]
  readonly kept: readonly {
    readonly id: string
    readonly reason: 'running' | 'fresh' | 'undated'
  }[]
}

/**
Reap stopped sandboxes past the person's retention (required, none by
default): exited, created-never-started and dead go once older than
it; running, fresh and undatable stay, each named. An `only` label
map reaps one workspace's boxes and leaves the rest untouched.
*/
export async function cleanupSandboxes(
  engine: Engine,
  retentionMs: number,
  nowMs: number,
  only?: Readonly<Record<string, string>>,
): Promise<SandboxCleanup> {
  const removed: string[] = []
  const kept: { id: string; reason: 'running' | 'fresh' | 'undated' }[] = []
  const wanted = Object.entries(only ?? {})
  const sandboxes = await listSandboxes(engine)
  for (const summary of sandboxes) {
    if (wanted.some(([key, value]) => summary.Labels[key] !== value)) continue
    if (summary.State !== 'exited' && summary.State !== 'created' && summary.State !== 'dead') {
      kept.push({ id: summary.Id, reason: 'running' })
      continue
    }
    const { parsed } = await inspectSandbox(engine, summary.Id)
    const dates = [Date.parse(parsed.Created), Date.parse(parsed.State.FinishedAt)].filter(
      (date) => !Number.isNaN(date),
    )
    if (dates.length === 0) {
      kept.push({ id: summary.Id, reason: 'undated' })
      continue
    }
    if (Math.max(...dates) + retentionMs > nowMs) {
      kept.push({ id: summary.Id, reason: 'fresh' })
      continue
    }
    await removeSandbox(engine, summary.Id, summary.State === 'dead')
    removed.push(summary.Id)
  }
  return { removed, kept }
}

const MUX_HEADER_BYTES = 8
const MUX_STDOUT = 1
const MUX_STDERR = 2
const MUX_LENGTH_OFFSET = 4

/** One demultiplexed payload off an exec stream. */
export interface MuxFrame {
  readonly stream: 'stdout' | 'stderr'
  readonly payload: Buffer
}

/**
The engine's multiplexed exec stream, one 8-byte header per frame
(stream, three zeroes, big-endian length) ahead of its payload.
Frames split across reads; the demuxer keeps the leftover.
*/
export class MuxDemuxer {
  private pending = Buffer.alloc(0)

  push(chunk: Buffer): MuxFrame[] {
    this.pending = Buffer.concat([this.pending, chunk])
    const frames: MuxFrame[] = []
    while (this.pending.length >= MUX_HEADER_BYTES) {
      const stream = this.pending[0]
      if (stream !== MUX_STDOUT && stream !== MUX_STDERR) {
        throw new EngineError(`engine exec: unknown stream ${String(stream)}`)
      }
      const length = this.pending.readUInt32BE(MUX_LENGTH_OFFSET)
      if (this.pending.length < MUX_HEADER_BYTES + length) break
      frames.push({
        stream: stream === MUX_STDOUT ? 'stdout' : 'stderr',
        payload: this.pending.subarray(MUX_HEADER_BYTES, MUX_HEADER_BYTES + length),
      })
      this.pending = this.pending.subarray(MUX_HEADER_BYTES + length)
    }
    return frames
  }
}

const execCreateSchema = z.looseObject({ Id: z.string() })
const execInspectSchema = z.looseObject({
  Running: z.boolean(),
  ExitCode: z.number(),
  ContainerID: z.string(),
})
const commitSchema = z.looseObject({ Id: z.string() })

/** Create an exec instance: the command runs when started, never before. */
export async function createExec(
  engine: Engine,
  containerId: string,
  command: readonly [string, ...string[]],
  options?: { readonly workdir?: string; readonly env?: readonly string[]; readonly user?: string },
): Promise<string> {
  const created = execCreateSchema.parse(
    await engineRequest(engine, 'POST', `/containers/${containerId}/exec`, {
      AttachStdout: true,
      AttachStderr: true,
      ...(options?.workdir !== undefined && { WorkingDir: options.workdir }),
      ...(options?.env !== undefined && { Env: options.env }),
      ...(options?.user !== undefined && { User: options.user }),
      Cmd: command,
    }),
  )
  return created.Id
}

/** Read an exec instance back: running, exit code, and which box it ran in. */
export async function inspectExec(
  engine: Engine,
  execId: string,
): Promise<{ readonly running: boolean; readonly exitCode: number; readonly containerId: string }> {
  const inspected = execInspectSchema.parse(
    await engineRequest(engine, 'GET', `/exec/${execId}/json`),
  )
  return {
    running: inspected.Running,
    exitCode: inspected.ExitCode,
    containerId: inspected.ContainerID,
  }
}

function isSameContainer(left: string, right: string): boolean {
  return left === right || left.startsWith(right) || right.startsWith(left)
}

/** A finished exec run: exit code and both streams, as bytes. */
export interface ExecResult {
  readonly exitCode: number
  readonly stdout: Buffer
  readonly stderr: Buffer
}

/**
Run an exec instance to completion and read its exit code back. The
container is asserted back from the exec record (short and full ids
both match); without a `maxBytes` the streams are unbounded — their
cap is the person's, owned by the workspace layer.
*/
export async function runExec(
  engine: Engine,
  containerId: string,
  execId: string,
  options?: { readonly maxBytes?: number },
): Promise<ExecResult> {
  const started = await rawRequest(
    engine.socketPath,
    enginePath(engine.apiVersion, `/exec/${execId}/start`),
    'POST',
    JSON.stringify({ Detach: false, Tty: false }),
  )
  if (!isSuccessStatus(started.status)) {
    const words = started.bytes.toString('utf8').slice(0, ERROR_SNIPPET_MAX_CHARS)
    throw new EngineError(
      `engine POST /exec/${execId}/start: ${String(started.status)} ${words}`,
      started.status,
    )
  }
  const demuxer = new MuxDemuxer()
  const out: Buffer[] = []
  const err: Buffer[] = []
  let collected = 0
  for (const frame of demuxer.push(started.bytes)) {
    collected += frame.payload.length
    if (options?.maxBytes !== undefined && collected > options.maxBytes) {
      throw new EngineError(`engine exec ${execId}: output over ${String(options.maxBytes)} bytes`)
    }
    ;(frame.stream === 'stdout' ? out : err).push(frame.payload)
  }
  const inspected = await inspectExec(engine, execId)
  if (!isSameContainer(inspected.containerId, containerId)) {
    throw new EngineError(`engine exec ${execId}: ran in another container`)
  }
  return { exitCode: inspected.exitCode, stdout: Buffer.concat(out), stderr: Buffer.concat(err) }
}

/** Drop an image, snapshot or base; a missing image fails, never silently passes. */
export async function removeImage(engine: Engine, image: string, isForced = false): Promise<void> {
  await engineRequest(
    engine,
    'DELETE',
    `/images/${encodeURIComponent(image)}?${new URLSearchParams({ force: String(isForced) }).toString()}`,
  )
}

/**
Freeze a sandbox into an image: the workspace's snapshot. The box
keeps running; the image carries repo and tag for the next box.
*/
export async function commitSandbox(
  engine: Engine,
  containerId: string,
  repo: string,
  tag: string,
): Promise<string> {
  const committed = commitSchema.parse(
    await engineRequest(
      engine,
      'POST',
      `/commit?${new URLSearchParams({ container: containerId, repo, tag }).toString()}`,
    ),
  )
  return committed.Id
}
