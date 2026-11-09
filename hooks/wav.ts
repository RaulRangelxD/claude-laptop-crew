// WAV and base64 helpers for playing sounds from memory (where $.audio.play has a
// player: macOS). Pure functions: no $, so they are tested on their own.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? B64[n & 63]! : '='
  }
  return out
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let o = 0
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]!) << 18) |
      (B64.indexOf(clean[i + 1] ?? 'A') << 12) |
      ((B64.indexOf(clean[i + 2] ?? 'A') & 63) << 6) |
      (B64.indexOf(clean[i + 3] ?? 'A') & 63)
    if (o < out.length) out[o++] = (n >> 16) & 255
    if (o < out.length) out[o++] = (n >> 8) & 255
    if (o < out.length) out[o++] = n & 255
  }
  return out
}

/**
 * A 16-bit PCM WAV read faster (higher and shorter by `pitch`) at `volume` (0..1),
 * as a new WAV; undefined when the bytes are no 16-bit PCM WAV.
 */
export function pitchWav(bytes: Uint8Array, pitch: number, volume: number): Uint8Array | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
  if (bytes.length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return undefined
  let pos = 12
  let channels = 0
  let rate = 0
  let bits = 0
  let format = 0
  let dataAt = -1
  let dataLen = 0
  while (pos + 8 <= bytes.length) {
    const id = tag(pos)
    const len = view.getUint32(pos + 4, true)
    if (id === 'fmt ') {
      format = view.getUint16(pos + 8, true)
      channels = view.getUint16(pos + 10, true)
      rate = view.getUint32(pos + 12, true)
      bits = view.getUint16(pos + 22, true)
    } else if (id === 'data') {
      dataAt = pos + 8
      dataLen = Math.min(len, bytes.length - dataAt)
    }
    pos += 8 + len + (len % 2)
  }
  if (format !== 1 || bits !== 16 || dataAt < 0 || channels < 1) return undefined

  const frames = Math.floor(dataLen / (2 * channels))
  const sample = (frame: number, c: number) => view.getInt16(dataAt + (frame * channels + c) * 2, true)
  const outFrames = Math.max(0, Math.floor((frames - 1) / pitch))
  const out = new Uint8Array(44 + outFrames * channels * 2)
  const w = new DataView(out.buffer)
  const put = (at: number, s: string) => [...s].forEach((ch, i) => (out[at + i] = ch.charCodeAt(0)))
  put(0, 'RIFF')
  w.setUint32(4, 36 + outFrames * channels * 2, true)
  put(8, 'WAVEfmt ')
  w.setUint32(16, 16, true)
  w.setUint16(20, 1, true)
  w.setUint16(22, channels, true)
  w.setUint32(24, rate, true)
  w.setUint32(28, rate * channels * 2, true)
  w.setUint16(32, channels * 2, true)
  w.setUint16(34, 16, true)
  put(36, 'data')
  w.setUint32(40, outFrames * channels * 2, true)
  for (let i = 0; i < outFrames; i++) {
    const p = i * pitch
    const j = Math.floor(p)
    const f = p - j
    for (let c = 0; c < channels; c++) {
      const a = sample(j, c)
      const v = (a + (sample(j + 1, c) - a) * f) * volume
      w.setInt16(44 + (i * channels + c) * 2, Math.max(-32768, Math.min(32767, Math.round(v))), true)
    }
  }
  return out
}
