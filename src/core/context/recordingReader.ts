import type { ContextIo } from './contextFiles'
import { AsyncLocalStorage } from 'node:async_hooks'
import { contentHash, type ContentSource } from '../schedules/provenance'

export interface ContentRead {
  readonly bytes: string | Uint8Array
  readonly source: ContentSource
  readonly isFullyShown?: boolean
}

/** Only a reader can close a scope; open scopes confer no authority. */
export class RecordingScope {
  public static build<T>(builder: (reader: RecordingScope) => T): {
    readonly value: T
    readonly scope: RecordingScope
  } {
    const scope = new RecordingScope()
    const value = builder(scope)
    scope.closed = true
    return { value, scope }
  }

  public static async run<T>(builder: (reader: RecordingScope) => Promise<T>): Promise<{
    readonly value: T
    readonly scope: RecordingScope
  }> {
    const scope = new RecordingScope()
    const value = await builder(scope)
    scope.closed = true
    return { value, scope }
  }

  private readonly inputs: ContentRead[] = []
  private closed = false
  private complete = true

  private constructor() {
    // Only the reader factories construct and close scopes.
  }

  public read<T>(
    value: T,
    bytes: string | Uint8Array,
    source: ContentSource,
    isFullyShown?: boolean,
  ): T {
    if (this.closed) throw new Error('Recording scope is closed')
    this.inputs.push({
      bytes: typeof bytes === 'string' ? bytes : Buffer.from(bytes),
      source,
      ...(isFullyShown !== undefined && { isFullyShown }),
    })
    return value
  }

  public sourceFor(path: string): ContentSource | undefined {
    return this.inputs.find(
      (input) =>
        (input.source.kind === 'file' || input.source.kind === 'skill') &&
        input.source.file.path.replaceAll('\\', '/') === path.replaceAll('\\', '/'),
    )?.source
  }

  public unrecordable(): void {
    if (this.closed) throw new Error('Recording scope is closed')
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
  public context(io: ContextIo): ContextIo {
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
      this.capture({ bytes, source })
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
        this.capture({
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

  public async run<T>(builder: (reader: RecordingScope) => Promise<T>): Promise<{
    readonly value: T
    readonly scope: RecordingScope
  }> {
    return await RecordingScope.run(
      async (reader) => await this.scopes.run(reader, async () => await builder(reader)),
    )
  }
}
