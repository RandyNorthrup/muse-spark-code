// M100 phase 2 (lane W): the installed approved encoder renders genuine QR
// matrices. Structural finder-pattern assertions pin the QR format itself,
// not the library's internals; they fail on the join base where this module
// does not exist and if the dependency is removed or broken.
import { describe, expect, it } from 'vitest'
import { isQrModuleMatrix } from '../../src/webview/models/sections/devices/qr/encoder'
import { qrGeneratorEncoder } from '../../src/webview/models/sections/devices/qr/qrGeneratorEncoder'

function finderTopLeft(size: number, isDark: (row: number, column: number) => boolean): void {
  // The 7x7 finder: dark outer ring, light ring, dark 3x3 core.
  for (let index = 0; index < 7; index += 1) {
    expect(isDark(0, index)).toBe(true)
    expect(isDark(6, index)).toBe(true)
    expect(isDark(index, 0)).toBe(true)
    expect(isDark(index, 6)).toBe(true)
  }
  expect(isDark(1, 1)).toBe(false)
  expect(isDark(1, 5)).toBe(false)
  expect(isDark(5, 1)).toBe(false)
  for (let row = 2; row <= 4; row += 1)
    for (let column = 2; column <= 4; column += 1) expect(isDark(row, column)).toBe(true)
  expect(size).toBeGreaterThanOrEqual(21)
}

describe('M100/W installed QR encoder', () => {
  it('renders a valid matrix with finder patterns for invitation-shaped text', () => {
    const text = JSON.stringify({
      version: 2,
      endpoint: { address: '192.168.1.10', port: 41_234 },
      fingerprint: 'ab'.repeat(32),
      certificateDerBase64: 'aGVsbG8=',
      validUntil: Date.now() + 600_000,
    })
    const first = qrGeneratorEncoder(text)
    expect(isQrModuleMatrix(first)).toBe(true)
    const isDark = (row: number, column: number) => first.modules[row]?.[column] === true
    finderTopLeft(first.size, isDark)
    // The top-right and bottom-left finders mirror the top-left one.
    expect(isDark(0, first.size - 1)).toBe(true)
    expect(isDark(first.size - 1, 0)).toBe(true)
    expect(qrGeneratorEncoder(text)).toEqual(first)
  })

  it('refuses text that cannot fit any QR version', () => {
    expect(() => qrGeneratorEncoder('x'.repeat(5000))).toThrow()
  })
})
