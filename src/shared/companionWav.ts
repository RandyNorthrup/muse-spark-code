import { MUSE_VOICE_BYTES_PER_SECOND, MUSE_VOICE_SAMPLE_RATE } from './constants'
import {
  COMPANION_VOICE_MAX_BYTES,
  COMPANION_VOICE_PCM_MAX,
  COMPANION_VOICE_PCM_MIN,
  COMPANION_VOICE_WAV_HEADER_BYTES,
} from './companionVoice'

// Fixed RIFF field offsets and geometry, not tunables.
const WAV = {
  size: 4,
  wave: 8,
  format: 12,
  formatSize: 16,
  encoding: 20,
  channels: 22,
  rate: 24,
  byteRate: 28,
  block: 32,
  bits: 34,
  data: 36,
  dataSize: 40,
  pcmFormatSize: 16,
  pcmBits: 16,
  wordBytes: 4,
}

/** Mix in float precision, then clip and round once; PCM addition can wrap. */
export function companionPcm(
  channels: readonly [Float32Array, ...Float32Array[]],
  length: number,
): Int16Array {
  const pcm = new Int16Array(length)
  for (let i = 0; i < length; i++) {
    let average = 0
    for (const channel of channels) average += (channel[i] ?? 0) / channels.length
    const value = Math.max(-1, Math.min(1, average))
    pcm[i] = Math.round(value * (value < 0 ? -COMPANION_VOICE_PCM_MIN : COMPANION_VOICE_PCM_MAX))
  }
  return pcm
}

export function companionWav(pcm: Int16Array): Uint8Array {
  const bytes = new Uint8Array(COMPANION_VOICE_WAV_HEADER_BYTES + pcm.byteLength)
  const view = new DataView(bytes.buffer)
  const word = (offset: number, text: string) => {
    bytes.set(new TextEncoder().encode(text), offset)
  }
  word(0, 'RIFF')
  word(WAV.wave, 'WAVE')
  word(WAV.format, 'fmt ')
  word(WAV.data, 'data')
  view.setUint32(WAV.size, bytes.length - WAV.wave, true)
  view.setUint32(WAV.formatSize, WAV.pcmFormatSize, true)
  view.setUint16(WAV.encoding, 1, true)
  view.setUint16(WAV.channels, 1, true)
  view.setUint32(WAV.rate, MUSE_VOICE_SAMPLE_RATE, true)
  view.setUint32(WAV.byteRate, MUSE_VOICE_BYTES_PER_SECOND, true)
  view.setUint16(WAV.block, 2, true)
  view.setUint16(WAV.bits, WAV.pcmBits, true)
  view.setUint32(WAV.dataSize, pcm.byteLength, true)
  for (let i = 0; i < pcm.length; i++)
    view.setInt16(COMPANION_VOICE_WAV_HEADER_BYTES + i * 2, pcm[i] ?? 0, true)
  return bytes
}

/** One canonical WAV shape, checked from bytes rather than a caller's duration. */
export function companionWavSeconds(bytes: Uint8Array): number {
  if (
    bytes.byteLength <= COMPANION_VOICE_WAV_HEADER_BYTES ||
    bytes.byteLength > COMPANION_VOICE_MAX_BYTES
  )
    throw new Error('EVOICE_SIZE')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const word = (offset: number) =>
    new TextDecoder().decode(bytes.subarray(offset, offset + WAV.wordBytes))
  if (
    word(0) !== 'RIFF' ||
    word(WAV.wave) !== 'WAVE' ||
    word(WAV.format) !== 'fmt ' ||
    word(WAV.data) !== 'data' ||
    view.getUint32(WAV.size, true) !== bytes.length - WAV.wave ||
    view.getUint32(WAV.formatSize, true) !== WAV.pcmFormatSize ||
    view.getUint16(WAV.encoding, true) !== 1 ||
    view.getUint16(WAV.channels, true) !== 1 ||
    view.getUint32(WAV.rate, true) !== MUSE_VOICE_SAMPLE_RATE ||
    view.getUint32(WAV.byteRate, true) !== MUSE_VOICE_BYTES_PER_SECOND ||
    view.getUint16(WAV.block, true) !== 2 ||
    view.getUint16(WAV.bits, true) !== WAV.pcmBits ||
    view.getUint32(WAV.dataSize, true) !== bytes.length - COMPANION_VOICE_WAV_HEADER_BYTES ||
    bytes.length % 2 !== 0
  )
    throw new Error('EVOICE_WAV')
  return (bytes.length - COMPANION_VOICE_WAV_HEADER_BYTES) / MUSE_VOICE_BYTES_PER_SECOND
}
