import { expect, it } from 'vitest'
import { COMPANION_VOICE_WAV_HEADER_BYTES } from '../../src/shared/constants'
import { companionPcm, companionWav, companionWavSeconds } from '../../src/shared/companionWav'

it('mixes stereo in float precision before clipping, so full-scale sums never wrap', () => {
  const full = new Float32Array([1, 1, 1, 1])
  expect([...companionPcm([full, full], 4)]).toEqual([32_767, 32_767, 32_767, 32_767])
  const hot = new Float32Array([2, 2, 2, 2])
  expect([...companionPcm([hot, hot], 4)]).toEqual([32_767, 32_767, 32_767, 32_767])
  const cold = new Float32Array([-2, -2, -2, -2])
  expect([...companionPcm([cold, cold], 4)]).toEqual([-32_768, -32_768, -32_768, -32_768])
  const half = new Float32Array([0.5, 0.5, 0.5, 0.5])
  const minusHalf = new Float32Array([-0.5, -0.5, -0.5, -0.5])
  expect([...companionPcm([half, minusHalf], 4)]).toEqual([0, 0, 0, 0])
})

it('writes one canonical mono WAV whose validated seconds match its samples', () => {
  const pcm = new Int16Array([0, 32_767, -32_768, 1000, -1000])
  const bytes = companionWav(pcm)
  expect(bytes.byteLength).toBe(COMPANION_VOICE_WAV_HEADER_BYTES + pcm.byteLength)
  expect(companionWavSeconds(bytes)).toBe(pcm.length / 16_000)
  expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF')
})

it('refuses bytes that are not the canonical shape', () => {
  const pcm = new Int16Array(160)
  const good = companionWav(pcm)
  const badMagic = Uint8Array.from(good)
  badMagic[0] = 'X'.codePointAt(0) ?? 0
  expect(() => companionWavSeconds(badMagic)).toThrow('EVOICE_WAV')
  const stereo = Uint8Array.from(good)
  new DataView(stereo.buffer).setUint16(22, 2, true)
  expect(() => companionWavSeconds(stereo)).toThrow('EVOICE_WAV')
  expect(() => companionWavSeconds(good.slice(0, COMPANION_VOICE_WAV_HEADER_BYTES))).toThrow(
    'EVOICE_SIZE',
  )
})
