// Original alert sting: a quick upward stab of two bright tones with a fast decay.
const fs = require('fs')
const RATE = 22050
function sting(base, length, file, amp = 1) {
  const n = Math.floor(RATE * length)
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    // First tone for 70ms, then a fifth above it, ringing out.
    const f = t < 0.07 ? base : base * 1.5
    const local = t < 0.07 ? t : t - 0.07
    const env = Math.min(1, local * 400) * Math.exp(-local * (t < 0.07 ? 18 : 7))
    // Triangle plus a little square: bright but not harsh.
    const ph = (t * f) % 1
    const tri = 4 * Math.abs(ph - 0.5) - 1
    const sq = ph < 0.5 ? 1 : -1
    const s = (0.75 * tri + 0.25 * sq) * env * 0.6 * amp
    data.writeInt16LE(Math.max(-1, Math.min(1, s)) * 32767, i * 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(data.length, 40)
  fs.writeFileSync(file, Buffer.concat([h, data]))
}
const out = process.argv[2]
sting(1046.5, 0.45, `${out}/alert.wav`)        // C6 then G6: this chat
sting(1568, 0.3, `${out}/alert-small.wav`, 0.45)      // G6 then D7, shorter: other chats and subagents
