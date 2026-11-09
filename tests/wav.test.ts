import { expect, test } from 'claude-code/testing'
import { fromBase64, pitchWav, toBase64 } from '../hooks/wav'

function wav(samples: number[]): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2)
  const w = new DataView(out.buffer)
  const put = (at: number, s: string) => [...s].forEach((c, i) => (out[at + i] = c.charCodeAt(0)))
  put(0, 'RIFF'); w.setUint32(4, 36 + samples.length * 2, true); put(8, 'WAVEfmt ')
  w.setUint32(16, 16, true); w.setUint16(20, 1, true); w.setUint16(22, 1, true)
  w.setUint32(24, 8000, true); w.setUint32(28, 16000, true); w.setUint16(32, 2, true); w.setUint16(34, 16, true)
  put(36, 'data'); w.setUint32(40, samples.length * 2, true)
  samples.forEach((s, i) => w.setInt16(44 + i * 2, s, true))
  return out
}

test('base64 round-trips any length', async () => {
  for (const n of [0, 1, 2, 3, 4, 5, 100]) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37) & 255)
    expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes])
  }
  expect(toBase64(Uint8Array.from([77, 97, 110]))).toBe('TWFu')
})

test('a WAV pitched by 1.5 is a third shorter and scaled by the volume', async () => {
  const src = wav(Array.from({ length: 100 }, (_, i) => i * 100))
  const out = pitchWav(src, 1.5, 0.5)!
  const view = new DataView(out.buffer)
  expect(view.getUint32(40, true) / 2).toBe(66)
  expect(view.getInt16(44 + 2 * 2, true)).toBe(150) // frame 2 reads source frame 3 (300) at half volume
})

test('anything but 16-bit PCM WAV is left alone', async () => {
  expect(pitchWav(new TextEncoder().encode('not a wav at all, just text padding....'), 1.5, 1)).toBeUndefined()
})
