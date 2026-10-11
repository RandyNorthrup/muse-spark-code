// Browser-free regressions for the portable startup measurement guards.
// The browser behavioral tests live in portableStartupTransports.test.mjs;
// these assertions guard the same class without launching Chrome: every probe
// and acknowledgement must travel over a sender captured before application
// code runs, and blob identity must ignore a fragment annotation.
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { portableUrlIdentity, WORKER_GUARD } from '../../scripts/lib/portableStartup.mjs'

const helper = readFileSync(
  new URL('../../scripts/lib/portableStartup.mjs', import.meta.url),
  'utf8',
)

it.each(['constructor', 'url getter'])(
  'the worker probe refuses a non-built Request behind a %s wrapper before dispatch',
  async (kind) => {
    // CSP can also refuse a data fetch in Chrome. Observe native dispatch here
    // without CSP so the Request-brand guard must independently do its job.
    class NativeRequest extends globalThis.Request {}
    Object.defineProperty(NativeRequest.prototype, 'url', {
      get: Object.getOwnPropertyDescriptor(globalThis.Request.prototype, 'url').get,
      configurable: true,
    })
    class ProbeUrl extends URL {}
    let dispatched = 0
    const context = {
      Request: NativeRequest,
      URL: ProbeUrl,
      Event: globalThis.Event,
      location: { href: 'http://127.0.0.1/assets/portable/worker.js' },
      postMessage: () => {
        // The thrown refusal is observed below; no receiver is needed.
      },
      addEventListener: () => {
        // This fixture deliberately injects no CSP or flush events.
      },
      importScripts: () => {
        // Only fetch is exercised in this fixture.
      },
      fetch: async () => {
        dispatched += 1
        return { ok: true }
      },
    }
    runInNewContext(WORKER_GUARD, context)
    const input = new NativeRequest('data:text/plain,unbuilt')
    if (kind === 'constructor') context.Request = class extends NativeRequest {}
    else
      Object.defineProperty(NativeRequest.prototype, 'url', {
        get: () => 'http://127.0.0.1/assets/portable/main.js',
      })
    await expect(context.fetch(input)).rejects.toThrow('PORTABLE_STARTUP_UNBUILT_REQUEST')
    expect(dispatched).toBe(0)
  },
)

describe('the worker probe delivers over its captured sender', () => {
  it('captures the native postMessage before application code runs', () => {
    expect(WORKER_GUARD).toContain(
      'const nativePostMessage = globalThis.postMessage.bind(globalThis)',
    )
  })
  it('sends every refusal and the flush acknowledgement through the capture', () => {
    expect(WORKER_GUARD.match(/nativePostMessage\({/g)).toHaveLength(4)
    expect(WORKER_GUARD).not.toContain('globalThis.postMessage({')
  })
  it('stops the flush event through the captured method', () => {
    expect(WORKER_GUARD).toContain('nativeStop.call(event)')
    expect(WORKER_GUARD).not.toContain('event.stopImmediatePropagation()')
  })
})

describe('the page instrumentation captures its reporting path', () => {
  it.each([
    'const nativeRefuse = globalThis.refusePortableStartupRequest',
    'const nativeRegister = globalThis.registerPortableStartupBlob',
    'const nativeWorkerRefusal = globalThis.refusePortableStartupWorker',
    'const nativeTarget = globalThis.refusePortableStartupTarget',
    'const nativeWorkerListen = Worker.prototype.addEventListener',
    'const nativeWorkerPost = Worker.prototype.postMessage',
    'const nativeWorkerTerminate = Worker.prototype.terminate',
  ])('captures %s before application code runs', (capture) => {
    expect(helper).toContain(capture)
  })
  it.each([
    'void globalThis.refusePortableStartupRequest(',
    'void globalThis.registerPortableStartupBlob(',
    'void globalThis.refusePortableStartupWorker(',
    'void globalThis.refusePortableStartupTarget(',
    'this.postMessage({ museStartupFlush: true })',
    "this.addEventListener('message'",
    'super.terminate()',
    'event.stopImmediatePropagation()',
  ])('never reports through the mutable %s', (mutable) => {
    expect(helper).not.toContain(mutable)
  })
})

describe('portableUrlIdentity', () => {
  it('ignores a fragment annotation on an admitted module blob', () => {
    expect(portableUrlIdentity('blob:http://127.0.0.1/uuid#annotation')).toBe(
      'blob:http://127.0.0.1/uuid',
    )
  })
  it('leaves bare module blob URLs unchanged', () => {
    expect(portableUrlIdentity('blob:http://127.0.0.1/uuid')).toBe('blob:http://127.0.0.1/uuid')
  })
  it('ignores a fragment on an http URL', () => {
    expect(portableUrlIdentity('http://127.0.0.1/assets/portable/main.js#x')).toBe(
      'http://127.0.0.1/assets/portable/main.js',
    )
  })
  it('matches the admitted check and the blob drain normalization', () => {
    expect(helper).toContain('!admitted.has(identity)')
    expect(helper).toContain('!moduleBlobs.has(portableUrlIdentity(request.url()))')
  })
})
