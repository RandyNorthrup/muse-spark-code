// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HeartbeatTrace } from '../../src/webview/components/HeartbeatTrace'

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)'
const FORCED_QUERY = '(forced-colors: active)'

interface MqlControl {
  api: unknown
  set: (isMatching: boolean) => void
  fire: () => void
}

// jsdom has no canvas backing and its matchMedia never matches, so both are
// faked per test with plain objects installed through defineProperty (which
// takes `any` and needs no cast).
function installMatchMedia() {
  const controls = new Map<string, MqlControl>()
  const matchMediaFake = (query: string) => {
    const existing = controls.get(query)
    if (existing !== undefined) {
      return existing.api
    }
    let isMatching = false
    const listeners = new Set<(event: Event) => void>()
    const api = {
      get matches() {
        return isMatching
      },
      media: query,
      addEventListener: (_type: string, listener: (event: Event) => void): void => {
        listeners.add(listener)
      },
      removeEventListener: (_type: string, listener: (event: Event) => void): void => {
        listeners.delete(listener)
      },
    }
    controls.set(query, {
      api,
      set: (isMatchingNext: boolean) => {
        isMatching = isMatchingNext
      },
      fire: () => {
        for (const listener of listeners) {
          listener(new Event('change'))
        }
      },
    })
    return api
  }
  Object.defineProperty(window, 'matchMedia', { value: matchMediaFake, configurable: true })
  // Entries are created on first use, so prime the query before render for a
  // pre-set match.
  const setMatches = (query: string, isMatching: boolean) => {
    window.matchMedia(query)
    const control = controls.get(query)
    expect(control).toBeDefined()
    control?.set(isMatching)
  }
  return { controls, setMatches }
}

function fakeContext(log: string[]) {
  let composite = ''
  let alpha = 1
  let style = ''
  const entry = (op: string, args: readonly number[]): void => {
    log.push(`${op} ${args.join(' ')}`)
  }
  return {
    beginPath: (): void => {
      log.push('beginPath')
    },
    moveTo: (x: number, y: number): void => {
      entry('moveTo', [x, y])
    },
    lineTo: (x: number, y: number): void => {
      entry('lineTo', [x, y])
    },
    stroke: (): void => {
      log.push('stroke')
    },
    save: (): void => {
      log.push('save')
    },
    restore: (): void => {
      log.push('restore')
    },
    fillRect: (x: number, y: number, w: number, h: number): void => {
      entry('fillRect', [x, y, w, h])
    },
    clearRect: (x: number, y: number, w: number, h: number): void => {
      entry('clearRect', [x, y, w, h])
    },
    set globalCompositeOperation(next: string) {
      log.push(`composite ${next}`)
      composite = next
    },
    get globalCompositeOperation(): string {
      return composite
    },
    set globalAlpha(next: number) {
      entry('alpha', [next])
      alpha = next
    },
    get globalAlpha(): number {
      return alpha
    },
    set strokeStyle(next: string) {
      log.push(`style ${next}`)
      style = next
    },
    get strokeStyle(): string {
      return style
    },
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
  }
}

function setCanvasBox(width: number, height: number) {
  Object.defineProperties(HTMLCanvasElement.prototype, {
    clientWidth: { value: width, configurable: true },
    clientHeight: { value: height, configurable: true },
  })
}

function setHidden(isHidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: isHidden, configurable: true })
}

describe('HeartbeatTrace (M87)', () => {
  let log: string[]
  let controls: Map<string, MqlControl>
  let setMatches: (query: string, isMatching: boolean) => void
  let frames: Map<number, FrameRequestCallback>
  let frameIdCounter = 1
  const cancel = vi.fn((id: number): void => {
    frames.delete(id)
  })

  const runFrame = (time: number) => {
    // Snapshot: each frame re-registers the next one while running.
    const pending: FrameRequestCallback[] = []
    frames.forEach((callback) => {
      pending.push(callback)
    })
    frames.clear()
    for (const callback of pending) {
      callback(time)
    }
  }

  beforeEach(() => {
    log = []
    frameIdCounter = 1
    frames = new Map()
    cancel.mockClear()
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value: () => fakeContext(log),
      configurable: true,
    })
    const installed = installMatchMedia()
    controls = installed.controls
    setMatches = installed.setMatches
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      const id = frameIdCounter
      frameIdCounter += 1
      frames.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', cancel)
    setCanvasBox(100, 24)
    setHidden(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(HTMLCanvasElement.prototype, 'getContext')
    Reflect.deleteProperty(HTMLCanvasElement.prototype, 'clientWidth')
    Reflect.deleteProperty(HTMLCanvasElement.prototype, 'clientHeight')
    Reflect.deleteProperty(window, 'matchMedia')
    Reflect.deleteProperty(document, 'hidden')
  })

  it('fades with destination-out before drawing each tick', () => {
    render(<HeartbeatTrace />)
    runFrame(16)
    const save = log.indexOf('save')
    const fade = log.indexOf('composite destination-out')
    const fill = log.findIndex((entry) => entry.startsWith('fillRect 0 0 100 24'))
    const restore = log.indexOf('restore')
    const begin = log.indexOf('beginPath')
    const stroke = log.indexOf('stroke')
    expect(save).toBeGreaterThanOrEqual(0)
    expect(fade).toBeGreaterThan(save)
    expect(fill).toBeGreaterThan(fade)
    expect(restore).toBeGreaterThan(fill)
    expect(begin).toBeGreaterThan(restore)
    expect(stroke).toBeGreaterThan(begin)
    expect(log).toContain('moveTo 0 12')
    expect(log).toContain('lineTo 0.5 12')
    expect(log).toContain('style currentColor')
  })

  it('wraps past the right edge with a pen lift, then restarts at the left', () => {
    render(<HeartbeatTrace />)
    for (let time = 16; time <= 4000; time += 20) {
      runFrame(time)
    }
    // A wrap tick fades but starts no segment: a save with no beginPath
    // before the next save.
    const saves = log.flatMap((entry, index) => (entry === 'save' ? [index] : []))
    expect(saves.length).toBeGreaterThan(10)
    const wrapIndex = saves.findIndex((start, i) => {
      const end = saves[i + 1] ?? log.length
      return !log.slice(start, end).includes('beginPath')
    })
    expect(wrapIndex).toBeGreaterThan(0)
    // And the beam keeps drawing afterwards instead of stopping at the edge.
    const wrapSave = saves[wrapIndex] ?? 0
    expect(log.slice(wrapSave)).toContain('stroke')
  })

  it('stops its loop on unmount', () => {
    const { unmount } = render(<HeartbeatTrace />)
    // Entering the loop cancels the (empty) previous frame first.
    cancel.mockClear()
    runFrame(16)
    expect(cancel).not.toHaveBeenCalled()
    const drawn = log.length
    expect(drawn).toBeGreaterThan(0)
    unmount()
    expect(cancel).toHaveBeenCalled()
    runFrame(32)
    runFrame(48)
    expect(log.length).toBe(drawn)
  })

  it('pauses while hidden and resumes when visible', () => {
    render(<HeartbeatTrace />)
    runFrame(16)
    const drawn = log.length
    setHidden(true)
    document.dispatchEvent(new Event('visibilitychange'))
    runFrame(32)
    runFrame(48)
    expect(log.length).toBe(drawn)
    setHidden(false)
    document.dispatchEvent(new Event('visibilitychange'))
    runFrame(1000)
    expect(log.length).toBeGreaterThan(drawn)
  })

  it('draws one still frame and starts no loop under reduced motion', () => {
    setMatches(REDUCED_QUERY, true)
    render(<HeartbeatTrace />)
    expect(frames.size).toBe(0)
    expect(log).toContain('clearRect 0 0 100 24')
    expect(log.filter((entry) => entry === 'stroke')).toHaveLength(1)
    expect(log.filter((entry) => entry.startsWith('lineTo'))).toHaveLength(100)
    expect(log).toContain('moveTo 0 12')
  })

  it('stops the loop when reduced motion turns on mid-run', () => {
    render(<HeartbeatTrace />)
    runFrame(16)
    expect(frames.size).toBe(1)
    setMatches(REDUCED_QUERY, true)
    controls.get(REDUCED_QUERY)?.fire()
    const drawn = log.length
    runFrame(32)
    expect(log.length).toBe(drawn)
    expect(log.filter((entry) => entry === 'stroke')).toHaveLength(3)
  })

  it('draws in CanvasText under forced colours', () => {
    setMatches(FORCED_QUERY, true)
    render(<HeartbeatTrace />)
    runFrame(16)
    expect(log).toContain('style CanvasText')
    expect(log.filter((entry) => entry.startsWith('composite'))).toEqual([
      'composite destination-out',
      'composite destination-out',
    ])
  })

  it('sizes the canvas by device pixels and re-sizes on window resize', () => {
    render(<HeartbeatTrace />)
    const canvas = document.querySelector('canvas')
    expect(canvas?.width).toBe(100)
    expect(canvas?.height).toBe(24)
    setCanvasBox(200, 48)
    window.dispatchEvent(new Event('resize'))
    expect(canvas?.width).toBe(200)
    expect(canvas?.height).toBe(48)
  })

  it('starts no loop when mounted while hidden', () => {
    setHidden(true)
    render(<HeartbeatTrace />)
    expect(frames.size).toBe(0)
    expect(log).toHaveLength(0)
  })

  it('renders without a loop when the context is missing', () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value: () => null,
      configurable: true,
    })
    render(<HeartbeatTrace />)
    expect(document.querySelector('canvas.heartbeat-trace')).not.toBeNull()
    expect(frames.size).toBe(0)
  })
})
