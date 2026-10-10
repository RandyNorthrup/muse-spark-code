import { UI_TEXT } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import type { ContextIo } from './contextFiles'
import type { RecordedOperation, RecordedResults } from '../backends/modelapi/schedulesEntry'
import { AsyncLocalStorage } from 'node:async_hooks'
import { contentHash, type ContentSource } from '../schedules/provenance'

export interface ContentRead {
  readonly bytes: string | Uint8Array
  readonly source: ContentSource
  readonly isFullyShown?: boolean
}

const READER_CONTENT = Symbol('ReaderContent')

/** A private field prevents an object spread from retaining the read brand. */
export class ReaderContent<T> {
  readonly #READER_CONTENT: T

  public constructor(value: T, authority: typeof READER_CONTENT) {
    if (authority !== READER_CONTENT) throw new Error('Reader content requires a recording reader')
    this.#READER_CONTENT = value
    Object.freeze(this)
  }

  public get value(): T {
    return this.#READER_CONTENT
  }
}

interface Projection<T> {
  readonly inputs: readonly ContentRead[]
  /** Pure helper: its output must depend only on the supplied recorded inputs. */
  readonly project: (inputs: readonly ContentRead[]) => T
  readonly isUnrecordable?: boolean
}

export function recordProjection<T>(reader: RecordingScope<T>): ReaderContent<T> {
  return reader.project(reader.readInputs(), reader.projection)
}

export async function recordOperation<T>(reader: RecordingScope<T>): Promise<ReaderContent<T>> {
  return await reader.load()
}

/** Fixed function identities; there is no caller-controlled registration API. */
export const RECORDING_BUILDERS = Object.freeze([recordProjection, recordOperation])

/** Only allowlisted builders can close a scope; open scopes confer no authority. */
export class RecordingScope<T = unknown> {
  public static build<T>(
    builder: typeof recordProjection,
    projection: Projection<T>,
  ): {
    readonly value: T
    readonly scope: RecordingScope<T>
  } {
    if (builder !== recordProjection) throw new Error('Unregistered recording builder')
    const scope = new RecordingScope<T>(projection)
    const content = recordProjection(scope)
    scope.closed = true
    return { value: content.value, scope }
  }

  public static async run<K extends keyof RecordedResults>(
    builder: typeof recordOperation,
    operation: Extract<RecordedOperation, { readonly kind: K }>,
    scopes = new AsyncLocalStorage<RecordingScope>(),
  ): Promise<{
    readonly value: RecordedResults[K]
    readonly scope: RecordingScope<RecordedResults[K]>
  }> {
    if (builder !== recordOperation) throw new Error('Unregistered recording builder')
    const scope = new RecordingScope<RecordedResults[K]>()
    scope.loader = async () => {
      const entry = await import('../backends/modelapi/schedulesEntry.js')
      entry.installLanguage(UI_TEXT, uiLocale())
      // The discriminant selects the result; TypeScript cannot correlate a generic
      // K with the switch's union result. PLAN §8 records this adapter assertion.
      return (await entry.loadRecordedOperation(operation, scope)) as RecordedResults[K]
    }
    const content = await scopes.run(scope, async () => await recordOperation(scope))
    scope.closed = true
    return { value: content.value, scope }
  }

  private readonly inputs: ContentRead[] = []
  private closed = false
  private complete = true

  private loader: (() => Promise<T>) | undefined

  private constructor(private readonly provided?: Projection<T>) {
    if (provided?.isUnrecordable === true) this.complete = false
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Recording scope is closed')
  }

  public get projection(): Projection<T>['project'] {
    if (this.provided === undefined) throw new Error('Missing recording projection')
    return this.provided.project
  }

  public readInputs(): ReaderContent<readonly ContentRead[]> {
    this.assertOpen()
    if (this.provided === undefined) throw new Error('Missing recording inputs')
    for (const input of this.provided.inputs)
      this.read(input.bytes, input.bytes, input.source, input.isFullyShown)
    return new ReaderContent(this.provided.inputs, READER_CONTENT)
  }

  public project<I, O>(input: ReaderContent<I>, project: (value: I) => O): ReaderContent<O> {
    this.assertOpen()
    return new ReaderContent(project(input.value), READER_CONTENT)
  }

  public async load(): Promise<ReaderContent<T>> {
    this.assertOpen()
    if (this.loader === undefined) throw new Error('Missing recording operation')
    return new ReaderContent(await this.loader(), READER_CONTENT)
  }

  public read<T>(
    value: T,
    bytes: string | Uint8Array,
    source: ContentSource,
    isFullyShown?: boolean,
  ): ReaderContent<T> {
    this.assertOpen()
    this.inputs.push({
      bytes: typeof bytes === 'string' ? bytes : Buffer.from(bytes),
      source,
      ...(isFullyShown !== undefined && { isFullyShown }),
    })
    return new ReaderContent(value, READER_CONTENT)
  }

  public context(io: ContextIo): ContextIo {
    this.assertOpen()
    return new RecordingReader().context(io, this)
  }

  public sourceFor(path: string): ContentSource | undefined {
    return this.inputs.find(
      (input) =>
        (input.source.kind === 'file' || input.source.kind === 'skill') &&
        input.source.file.path.replaceAll('\\', '/') === path.replaceAll('\\', '/'),
    )?.source
  }

  public unrecordable(): void {
    this.assertOpen()
    this.complete = false
  }

  public inventory(): readonly ContentRead[] | undefined {
    return this.closed && this.complete
      ? this.inputs.map((input) => ({
          ...input,
          bytes: typeof input.bytes === 'string' ? input.bytes : Buffer.from(input.bytes),
        }))
      : undefined
  }

  public hashes(): readonly string[] {
    return (this.inventory() ?? []).map((input) => contentHash(input.bytes))
  }
}

/** Session-owned recording on top of its existing guarded I/O ports. */
export class RecordingReader {
  private readonly scopes = new AsyncLocalStorage<RecordingScope>()

  public capture(input: ContentRead): void {
    this.scopes.getStore()?.read(input.bytes, input.bytes, input.source, input.isFullyShown)
  }

  public unrecordable(): void {
    this.scopes.getStore()?.unrecordable()
  }

  /** Only guarded ports enter this adapter; builders receive its recording port. */
  public context(io: ContextIo, scope?: RecordingScope): ContextIo {
    const capture = (input: ContentRead): void => {
      if (scope === undefined) this.capture(input)
      else scope.read(input.bytes, input.bytes, input.source, input.isFullyShown)
    }
    const readSource: NonNullable<ContextIo['readSource']> = async (path, maxBytes) => {
      const captured = await io.readSource?.(path, maxBytes)
      const bytes =
        io.readSource === undefined ? await io.readFile(path, maxBytes) : captured?.bytes
      if (bytes === undefined) return
      const canonical = captured?.source.file.path ?? (await io.realPath(path))
      const source =
        captured?.source ??
        ({
          kind: 'file',
          contentHash: contentHash(bytes),
          file: {
            path: canonical.replaceAll('\\', '/'),
            dev: '0',
            ino: '0',
            size: bytes.length,
            mtime: '0',
          },
        } as const)
      capture({ bytes, source })
      return { bytes, source }
    }
    return {
      realPath: (path) => io.realPath(path),
      readSource,
      readFile: async (path, maxBytes) => {
        const captured = await readSource(path, maxBytes)
        return captured?.bytes
      },
      listDirectory: async (path) => {
        const names = await io.listDirectory(path)
        const canonical = await io.realPath(path)
        const bytes = JSON.stringify(names)
        capture({
          bytes,
          source: {
            kind: 'directory',
            paths: await Promise.all(
              names.map(async (name) => {
                const member = await io.realPath(canonical.replaceAll('\\', '/') + '/' + name)
                return member.replaceAll('\\', '/')
              }),
            ),
            contentHash: contentHash(bytes),
          },
        })
        return names
      },
    }
  }

  public async run<K extends keyof RecordedResults>(
    builder: typeof recordOperation,
    operation: Extract<RecordedOperation, { readonly kind: K }>,
  ): Promise<{
    readonly value: RecordedResults[K]
    readonly scope: RecordingScope<RecordedResults[K]>
  }> {
    return await RecordingScope.run(builder, operation, this.scopes)
  }
}
