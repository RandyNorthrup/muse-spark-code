// M111 lane OB: crash records carry fixed kinds, a short code and
// scrubbed frames; raw memory dumps never qualify; Electron's crash
// reporter never uploads (D64).
import { describe, expect, it } from 'vitest'
import {
  buildCrashRecord,
  electronCrashReporterOptions,
  isRawCoreName,
  parseCrashLine,
  serializeCrashRecord,
} from '../../../src/core/o11y/crash'

const AT = 1_761_864_000_000

describe('crash records', () => {
  it('builds a record with scrubbed frames and reads it back', () => {
    const built = buildCrashRecord(
      {
        component: 'shell',
        kind: 'panic',
        code: 'SIGSEGV',
        frames: [
          { symbol: 'muse_shell::bar::render', line: 42 },
          { path: 'dist/shell.js', line: 10, column: 4 },
        ],
      },
      AT,
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.record).toMatchObject({ v: 1, at: AT, component: 'shell', kind: 'panic' })
    expect(parseCrashLine(serializeCrashRecord(built.record).trimEnd())).toEqual(built.record)
  })

  it('drops secret-shaped and absolute frames while the record still lands', () => {
    const built = buildCrashRecord(
      {
        component: 'node',
        kind: 'uncaught',
        code: 'TypeError',
        frames: [
          { path: '/etc/passwd' },
          { path: 'sk-xxxxxxxxxxxxxxxxxxxxxxxx.js' },
          { path: 'dist/node.js', line: 1 },
        ],
      },
      AT,
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.record.frames).toEqual([{ path: 'dist/node.js', line: 1 }])
  })

  it('refuses unknown components and kinds, and malformed lines read absent', () => {
    expect(buildCrashRecord({ component: 'some-daemon', kind: 'panic', code: 'x' }, AT)).toEqual({
      ok: false,
      reason: 'unknownComponent',
    })
    expect(buildCrashRecord({ component: 'node', kind: 'melted', code: 'x' }, AT)).toEqual({
      ok: false,
      reason: 'unknownKind',
    })
    expect(parseCrashLine('not json')).toBeUndefined()
    expect(parseCrashLine('{"v":2}')).toBeUndefined()
  })

  it('forces the crash reporter upload off whatever the caller asked', () => {
    const options = electronCrashReporterOptions({
      companyName: 'Muse Spark',
      productName: 'Muse Desktop',
      submitURL: 'https://collector.example.com/crash',
      uploadToServer: true,
      rateLimit: false,
    })
    expect(options).toEqual({
      companyName: 'Muse Spark',
      productName: 'Muse Desktop',
      uploadToServer: false,
      rateLimit: false,
      compress: true,
    })
    expect('submitURL' in options).toBe(false)
  })

  it('names raw memory dumps so the store and bundle refuse them', () => {
    expect(isRawCoreName('core')).toBe(true)
    expect(isRawCoreName('core.1234')).toBe(true)
    expect(isRawCoreName('renderer.dmp')).toBe(true)
    expect(isRawCoreName('app.core')).toBe(true)
    expect(isRawCoreName(String.raw`C:\crashes\renderer.dmp`)).toBe(true)
    expect(isRawCoreName('crash-2026-10-31.jsonl')).toBe(false)
    expect(isRawCoreName('record.json')).toBe(false)
  })
})
