import { describe, expect, it } from 'vitest'
import { SurfaceRegistry } from '../../src/host/views/surfaceRegistry'
import { fakeSurface } from './helpers/fakes'

describe('SurfaceRegistry', () => {
  it('starts empty with no active surface', () => {
    const registry = new SurfaceRegistry()
    expect(registry.size).toBe(0)
    expect(registry.active).toBeUndefined()
  })

  it('treats the first registered surface as active until told otherwise', () => {
    const registry = new SurfaceRegistry()
    const first = fakeSurface('a')
    const second = fakeSurface('b')
    registry.add(first)
    registry.add(second)
    expect(registry.active).toBe(first)
    registry.setActive(second)
    expect(registry.active).toBe(second)
  })

  it('ignores setActive for a surface it does not know', () => {
    const registry = new SurfaceRegistry()
    const known = fakeSurface('a')
    registry.add(known)
    registry.setActive(fakeSurface('stranger'))
    expect(registry.active).toBe(known)
  })

  it('falls back to another surface when the active one is unregistered', () => {
    const registry = new SurfaceRegistry()
    const first = fakeSurface('a')
    const second = fakeSurface('b')
    const registration = registry.add(first)
    registry.add(second)
    registration.dispose()
    expect(registry.size).toBe(1)
    expect(registry.active).toBe(second)
  })

  it('keeps the active surface when a different one is unregistered', () => {
    const registry = new SurfaceRegistry()
    const first = fakeSurface('a')
    const second = fakeSurface('b')
    registry.add(first)
    const registration = registry.add(second)
    registration.dispose()
    expect(registry.active).toBe(first)
  })

  it('broadcasts to every registered surface', () => {
    const registry = new SurfaceRegistry()
    const first = fakeSurface('a')
    const second = fakeSurface('b')
    registry.add(first)
    registry.add(second)
    registry.broadcast({ type: 'focusInput' })
    expect(first.posted).toEqual([{ type: 'focusInput' }])
    expect(second.posted).toEqual([{ type: 'focusInput' }])
  })
})
