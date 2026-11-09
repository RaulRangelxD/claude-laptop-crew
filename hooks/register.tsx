import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { Worker } from '../types'
import { fromBase64, pitchWav, toBase64 } from './wav'

const local = atom({ plugin: 'laptop-crew', key: 'local' } as const, [] as Worker[])
const chats = atom({ plugin: 'laptop-crew', key: 'chats' } as const, [] as Worker[])

const PANE = 'crew'
const MAIN = 'main'
const POLL_MS = 3000
// shortcut: a chat that crashed without writing 'gone' shows until its file is 2h old.
const STALE_MS = 2 * 60 * 60 * 1000
const MASCOT_COLOR = '#D97757'
const LAPTOP_COLOR = '#C9C9C9'
/** One figure's box: 84 wide, 66 tall (the "!" on top to the laptop's base). */
const CELL = 84
const HEIGHT = 66
/** Room above the figures: the "!" pops to 1.5x and hovers up 2px past the box's top. */
const PAD = 10
/** The small figures: a third of the big one, stacked on its left. */
const SMALL = 1 / 3

/** The person's options (the manifest's userConfig), clamped to what the drawing can hold. */
type Config = {
  sound: boolean
  alertMs: number
  maxSmall: number
  smallVolume: number
  /** Both sounds (0..1); the small one plays at volume times smallVolume. */
  volume: number
  customSound: string
  mascotColor: string
  laptopColor: string
  /** Where the mascots sit when the band holds nothing else. */
  aloneAlign: "left" | "center" | "right"
  /** Which side the mascots take beside other band content (ponytail's menu). */
  sharedSide: "left" | "right"
  /** Which side of the big mascot the minis stack on. */
  miniSide: "left" | "right"
}

/** A "#rgb" or "#rrggbb" color (the # optional) as "#rrggbb"; undefined for anything else. */
function hexColor(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim())
  if (!m) return undefined
  const h = m[1]!.length === 3 ? [...m[1]!].map(c => c + c).join('') : m[1]!
  return `#${h.toUpperCase()}`
}

/** The same color darker by `factor` (0..1): the laptop's edge and base from its color. */
function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16)
  const part = (s: number) => Math.round(((n >> s) & 255) * factor).toString(16).padStart(2, '0')
  return `#${part(16)}${part(8)}${part(0)}`
}

/** One of `allowed`, or `fallback` for anything else. */
function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback
}

function readConfig(o: PluginOptions): Config {
  const num = (v: unknown, fallback: number, lo: number, hi: number) => {
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) && v !== '' ? Math.min(hi, Math.max(lo, n)) : fallback
  }
  return {
    sound: o.sound !== false,
    alertMs: num(o.alertSeconds, 60, 5, 3600) * 1000,
    maxSmall: Math.round(num(o.maxSmall, 3, 0, 3)),
    smallVolume: num(o.smallVolume, 45, 0, 100) / 100,
    volume: num(o.volume, 100, 0, 100) / 100,
    customSound: typeof o.customSound === 'string' ? o.customSound.trim() : '',
    mascotColor: hexColor(o.mascotColor) ?? MASCOT_COLOR,
    laptopColor: hexColor(o.laptopColor) ?? LAPTOP_COLOR,
    aloneAlign: pick(o.aloneAlign, ["left", "center", "right"] as const, "center"),
    sharedSide: pick(o.sharedSide, ["left", "right"] as const, "right"),
    miniSide: pick(o.miniSide, ["left", "right"] as const, "left"),
  }
}

// Module state: starts over on a hot reload, which register and session.start set up again.
let cfg = readConfig({})
let timer: { cancel: () => void } | undefined
let dir: string | undefined
let file: string | undefined
let lastChats = ''
/** Where the sounds Windows plays are prepared (big.wav, small.wav), once they are ready. */
let soundDir: string | undefined
let soundsReady = false

const short = (s: string) => (s.length > 13 ? `${s.slice(0, 12)}…` : s)
const loop = (attr: string, values: string, dur: string, extra = '') =>
  `<animate attributeName="${attr}" values="${values}" dur="${dur}" repeatCount="indefinite" ${extra}/>`

/**
 * The pixel mascot and a laptop seen from behind, at (x, y). Animation is SMIL:
 * no timers, no redraws. Working: hidden behind the lid, only the top of its head
 * bobbing, with typing dots. Done: it rises, grips the lid and a red "!" pops over
 * its head. Idle: hidden and still, with a "z".
 */
function figure(w: Worker, x: number, y: number): string {
  const working = w.status === 'working'
  const done = w.status === 'done'
  const idle = w.status === 'idle'
  const body = cfg.mascotColor
  const lid = cfg.laptopColor
  const edge = shade(lid, 0.6)
  const u = 3 // one pixel of the sprite
  const px = (cx: number, cy: number, cw: number, ch: number, fill: string, inner = '') =>
    `<rect x="${cx * u}" y="${cy * u}" width="${cw * u}" height="${ch * u}" fill="${fill}">${inner}</rect>`
  const eye = (cx: number) =>
    px(cx, 2, 1, 2, '#1A1A1A', loop('height', `${2 * u};${2 * u};${0.4 * u};${2 * u}`, '3.6s', 'keyTimes="0;0.92;0.96;1"'))

  // Behind the lid only the top rows of the body show; done, it rises 9px to peek over.
  const HIDDEN = 9
  const motion = working
    ? `<animateTransform attributeName="transform" type="translate" values="0 ${HIDDEN};0 ${HIDDEN - 2};0 ${HIDDEN}" dur="0.64s" repeatCount="indefinite"/>`
    : done
      ? `<animateTransform attributeName="transform" type="translate" values="0 ${HIDDEN};0 -2;0 0" keyTimes="0;0.7;1" dur="0.4s" fill="freeze"/>`
      : ''
  const at = `translate(${x + 27} ${y + 22})`
  const mascot = `<g transform="${at}" opacity="${idle ? 0.6 : 1}">
    <g transform="translate(0 ${done ? 0 : HIDDEN})">${motion}${px(0, 0, 10, 7, body)}${eye(2)}${eye(7)}</g></g>`
  // Drawn after the laptop so the hands grip the lid's top edge once it peeks.
  // They sit on the lid's edge and only show once the body has risen (its rise peaks at 0.28 s):
  // rising with it they would be drawn over the middle of the lid on the way up.
  const hands = done
    ? `<g transform="${at}" opacity="0"><set attributeName="opacity" to="1" begin="0.28s" fill="freeze"/>${px(-1, 4, 2, 1, body)}${px(9, 4, 2, 1, body)}</g>`
    : ''

  // The back of the laptop's lid, a small spark on it, and the base under it.
  const laptop = `<g transform="translate(${x} ${y})">
    <rect x="18" y="36" width="48" height="24" rx="3" fill="${lid}" stroke="${edge}" stroke-width="1.2"/>
    <circle cx="42" cy="48" r="3" fill="${body}" opacity="0.85">${working ? loop('opacity', '0.4;1;0.4', '1.4s') : ''}</circle>
    <rect x="18" y="60" width="48" height="4" rx="2" fill="${edge}"/>
  </g>`

  // Typing dots over the head while it works, lit one after another.
  const typing = working
    ? [0, 1, 2]
        .map(i => `<rect x="${x + 35 + i * 5}" y="${y + 20}" width="3" height="3" rx="0.5" fill="${body}" opacity="0.2">${loop('opacity', '0.2;1;0.2', '0.9s', `begin="${i * 0.3}s"`)}</rect>`)
        .join('')
    : ''

  // A bold red "!" that pops in once the mascot has peeked out, then hovers.
  const alert = done
    ? `<g transform="translate(${x + 42} ${y + 18})"><g transform="scale(0)">
          <animateTransform attributeName="transform" type="scale" values="0;1.5;1" keyTimes="0;0.6;1" dur="0.35s" begin="0.4s" fill="freeze"/>
          <g>
            <animateTransform attributeName="transform" type="translate" values="0 0;0 -2;0 0" dur="1s" begin="0.75s" repeatCount="indefinite"/>
            <text x="0" y="0" text-anchor="middle" font-family="Arial Black, Impact, sans-serif" font-weight="900" font-size="24"
              fill="#E5322D" stroke="#FFFFFF" stroke-width="2.5" paint-order="stroke" stroke-linejoin="round">!</text>
          </g>
        </g></g>`
    : ''

  const zzz = idle
    ? `<text x="${x + 62}" y="${y + 30}" font-size="10" font-family="sans-serif" fill="#8A8A8A">z${loop('opacity', '0.2;1;0.2', '2.5s')}</text>`
    : ''

  return `<g>${mascot}${laptop}${hands}${typing}${alert}${zzz}</g>`
}

async function setLocal($: EngineInterface, id: string, patch: Partial<Worker>) {
  await update($, local, list => {
    const i = list.findIndex(w => w.id === id)
    if (i < 0) return [...list, { id, label: patch.label ?? id, status: 'idle' as const, ...patch }]
    return list.map((w, j) => (j === i ? { ...w, ...patch } : w))
  })
}

/** Writes this chat's status where the other chats' copies of the mod read it. */
async function publish($: EngineInterface, status: Worker['status'] | 'gone') {
  if (!file) return
  const root = await $.session.root()
  const label = root.split(/[\\/]/).filter(Boolean).pop() ?? 'chat'
  await $.fs.write(file, JSON.stringify({ label, status, at: await $.clock.now() })).catch(() => {})
}

async function poll($: EngineInterface) {
  if (!dir || !(await $.fs.exists(dir))) return
  const now = await $.clock.now()
  const mine = file?.split('/').pop()
  const found: Worker[] = []
  for (const entry of await $.fs.list(dir)) {
    if (!entry.name.endsWith('.json') || entry.name === mine || now - entry.mtimeMs > STALE_MS) continue
    try {
      const v = JSON.parse(await $.fs.read(`${dir}/${entry.name}`)) as { label: string; status: string; at: number }
      const id = entry.name.slice(0, -5)
      // Another chat's "!" ages out on its own timestamp, within one poll of the alert time.
      if (v.status === 'working' || (v.status === 'done' && now - v.at < cfg.alertMs)) {
        found.push({ id, label: v.label, status: v.status, at: v.at })
      }
    } catch {
      // a file mid-write reads as broken JSON: the next poll gets it
    }
  }
  const key = JSON.stringify(found)
  if (key === lastChats) return
  lastChats = key
  const before = await read($, chats)
  // Only a chat seen working and now done chimes: a "!" already there at startup stays quiet.
  if (found.some(w => w.status === 'done' && before.find(b => b.id === w.id)?.status === 'working')) chime($, true)
  await update($, chats, () => found)
}

const isWindows = (root: string) => /^[A-Za-z]:[\\/]/.test(root)

/**
 * Windows: builds big.wav (the person's own sound, or ours) and small.wav (higher,
 * shorter, at the small volume) with sounds/prepare.ps1, unless the last build used
 * the same file and volume. A sound that cannot be read falls back to ours.
 */
async function prepareSounds($: EngineInterface) {
  soundsReady = false
  const root = $.plugin.root
  if (!soundDir || !isWindows(root)) return
  const ours = `${root}\\sounds\\alert.wav`
  for (const source of cfg.customSound ? [cfg.customSound, ours] : [ours]) {
    const stat = await $.fs.stat(source).catch(() => undefined)
    if (stat?.kind !== 'file') {
      $.ui.log(`laptop-crew: no encuentro el audio ${source}; uso el sonido incluido`)
      continue
    }
    const key = JSON.stringify({ source, mtime: stat.mtimeMs, size: stat.size, volume: cfg.smallVolume, master: cfg.volume })
    const built = await $.fs.read(`${soundDir}/key.json`).catch(() => '')
    if (built === key && (await $.fs.exists(`${soundDir}/small.wav`))) {
      soundsReady = true
      return
    }
    const ran = await $.process
      .run(
        ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', `${root}\\sounds\\prepare.ps1`,
          '-Source', source, '-OutDir', soundDir, '-Pitch', '1.5', '-SmallVolume', String(cfg.smallVolume), '-Volume', String(cfg.volume)],
        { timeoutMs: 60_000 },
      )
      .catch(err => ({ exitCode: -1, stdout: '', stderr: String(err) }))
    if (ran.exitCode === 0) {
      await $.fs.write(`${soundDir}/key.json`, key)
      soundsReady = true
      return
    }
    $.ui.log(`laptop-crew: no pude preparar ${source} (${ran.stderr.split('\n')[0]}); uso el sonido incluido`)
  }
}

/** When the "!" pops after its mascot starts to rise (the alert's animation `begin`). */
const POP_MS = 400

/** The warm player's files (Windows), while it runs: a WAV path written to `trigger` plays at once. */
let player: { trigger: string; heartbeat: string; beat: { cancel: () => void } } | undefined

/** Starts sounds/player.ps1 for this session's life, so a sound starts with the "!" instead of 0.5 s late. */
async function startPlayer($: EngineInterface, id: string) {
  const root = $.plugin.root
  if (!soundDir || !isWindows(root) || player) return
  const trigger = `${soundDir}/go-${id}.txt`
  const heartbeat = `${soundDir}/alive-${id}.txt`
  await $.fs.write(heartbeat, String(await $.clock.now()))
  const beat = $.clock.every(10_000, () => void $.fs.write(heartbeat, 'alive').catch(() => {}))
  player = { trigger, heartbeat, beat }
  const child = $.process.spawn({
    argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', `${root}\\sounds\\player.ps1`,
      '-Trigger', trigger, '-Heartbeat', heartbeat],
  })
  try {
    for await (const _ of child) {
      // its output is nothing: the loop only keeps it alive for the session
    }
  } finally {
    beat.cancel()
    player = undefined
  }
}

/** The alert sting: this chat's at full volume, a small one's higher and softer. */
function chime($: EngineInterface, small: boolean) {
  if (!cfg.sound || cfg.volume === 0 || (small && cfg.smallVolume === 0)) return
  const root = $.plugin.root
  // $.audio.play has no player on Windows and stays silent there: Windows' own SoundPlayer plays it.
  if (isWindows(root)) {
    const name = small ? 'small.wav' : 'big.wav'
    const file = soundsReady && soundDir ? `${soundDir}/${name}` : `${root}\\sounds\\${small ? 'alert-small.wav' : 'alert.wav'}`
    const warm = player
    if (warm) {
      $.clock.after(POP_MS, () => void $.fs.write(warm.trigger, file.replace(/\//g, '\\')).catch(() => {}))
      return
    }
    const path = file.replace(/'/g, "''")
    void $.process
      .run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', `(New-Object Media.SoundPlayer '${path}').PlaySync()`], {
        timeoutMs: 30_000,
      })
      .catch(() => {})
    return
  }
  // Elsewhere (macOS) $.audio.play takes the bytes: the pitched copy is made in memory.
  void memoryClips($)
    .then(clips => {
      const clip = small ? clips.small : clips.big
      return $.audio.play({ base64: clip.base64, mime: clip.mime }, { gain: clip.gain })
    })
    .catch(() => {})
}

type Clip = { base64: string; mime: string; gain: number }
/** The last clips built, by source and volume: a sound is read and pitched once, not per chime. */
let memo: { key: string; big: Clip; small: Clip } | undefined

const MIME: Record<string, string> = { wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', aiff: 'audio/aiff', aif: 'audio/aiff' }

/** The big clip (the own sound or ours) and the small one (pitched up and softer; a non-WAV only softer). */
async function memoryClips($: EngineInterface): Promise<{ big: Clip; small: Clip }> {
  const ours = `${$.plugin.root}/sounds/alert.wav`
  const wanted = cfg.customSound || ours
  const key = `${wanted}|${cfg.smallVolume}|${cfg.volume}`
  if (memo?.key === key) return memo
  let source = wanted
  let read = await $.fs.read(wanted, { as: 'bytes' }).catch(() => undefined)
  if (!read) {
    $.ui.log(`laptop-crew: no pude leer el audio ${wanted}; uso el sonido incluido`)
    source = ours
    read = await $.fs.read(ours, { as: 'bytes' })
  }
  const mime = MIME[source.split('.').pop()?.toLowerCase() ?? ''] ?? 'audio/wav'
  const big = { base64: read.base64, mime, gain: cfg.volume }
  const pitched = mime === 'audio/wav' ? pitchWav(fromBase64(read.base64), 1.5, cfg.smallVolume) : undefined
  const small = pitched
    ? { base64: toBase64(pitched), mime: 'audio/wav', gain: cfg.volume }
    : { ...big, gain: cfg.volume * cfg.smallVolume }
  memo = { key, big, small }
  return memo
}

/** Whether what the plugins beneath drew in the band is nothing: none, or Boxes holding nothing. */
function isEmptyTree(tree: unknown): boolean {
  if (tree === null || tree === undefined || tree === false || tree === '') return true
  if (Array.isArray(tree)) return tree.every(isEmptyTree)
  if (typeof tree !== 'object') return false
  const node = tree as { type?: unknown; children?: unknown }
  // With ponytail's band hidden the band holds only the engine's own node, which draws nothing here.
  return isEngineNode(tree) || (node.type === 'Box' && isEmptyTree(node.children ?? []))
}

const isEngineNode = (tree: unknown) => typeof tree === 'object' && tree !== null && (tree as { type?: unknown }).type === 'engine'

/** The options pane `/crew` opens. */
const OPTIONS = 'crew-options'

/** Writes one option as the /config menu would; the engine reloads the mod with it. */
async function saveOption($: EngineInterface, field: string, value: string | number | boolean) {
  const result = await $.config.set({ key: `${$.plugin.name}.${field}`, value })
  if ('deny' in result && result.deny) $.ui.toast(`laptop-crew: no se pudo guardar ${field}: ${result.deny}`)
}

/** A number typed in the pane, kept inside its range; anything else is refused with a toast. */
async function saveNumber($: EngineInterface, field: string, text: string, lo: number, hi: number) {
  const n = Number(text.trim().replace(',', '.'))
  if (text.trim() === '' || !Number.isFinite(n)) {
    $.ui.toast(`laptop-crew: "${text}" no es un número`)
    return
  }
  await saveOption($, field, Math.min(hi, Math.max(lo, n)))
}

/** The helper preview with as many helpers as typed (1 to 50). */
async function demoCount($: EngineInterface, text: string) {
  const n = Math.round(Number(text.trim()))
  if (text.trim() === '' || !Number.isFinite(n) || n < 1) {
    $.ui.toast(`laptop-crew: "${text}" no es una cantidad; escribe un número desde 1`)
    return
  }
  await demoCrowd($, Math.min(50, n))
}

/** A color typed in the pane: empty goes back to the default, a non-color is refused with a toast. */
async function saveColor($: EngineInterface, field: string, text: string, fallback: string) {
  const color = text.trim() === '' ? fallback : hexColor(text)
  if (!color) {
    $.ui.toast(`laptop-crew: "${text}" no es un color; usa por ejemplo #D97757`)
    return
  }
  await saveOption($, field, color)
}

// Previews for the /crew panel: they change only this window's mascots, never what other chats read.
const DEMO = 'demo:'
const isDemo = (w: Worker) => w.id.startsWith(DEMO)

/** This chat's mascot working, as during a turn, for 10 s. */
async function demoWorking($: EngineInterface) {
  const at = await $.clock.now()
  await setLocal($, MAIN, { status: 'working', at })
  $.clock.after(10_000, () =>
    void read($, local)
      .then(list => (list.find(w => w.id === MAIN)?.at === at ? setLocal($, MAIN, { status: 'idle' }) : undefined))
      .catch(() => {}),
  )
}

/** This chat's mascot finishing: the "!", its sound and the usual return to sleep. */
async function demoDone($: EngineInterface) {
  const at = await $.clock.now()
  await setLocal($, MAIN, { status: 'done', at })
  chime($, false)
  $.clock.after(cfg.alertMs, () => void endAlert($, MAIN, at).catch(() => {}))
}

/** Five helpers at work (three small mascots and a +2); after 3 s one finishes, with the small sound. */
async function demoCrowd($: EngineInterface, count = 5) {
  const names = Array.from({ length: count }, (_, i) => (i === 0 ? 'a' : String(i + 1)))
  await update($, local, list => [
    ...list.filter(w => !isDemo(w)),
    ...names.map(n => ({ id: `${DEMO}${n}`, label: `prueba ${n}`, status: 'working' as const })),
  ])
  $.clock.after(3_000, () => void demoFinishOne($).catch(() => {}))
  $.clock.after(15_000, () => void update($, local, list => list.filter(w => !isDemo(w))).catch(() => {}))
}

async function demoFinishOne($: EngineInterface) {
  const at = await $.clock.now()
  if (!(await read($, local)).some(w => w.id === `${DEMO}a`)) return
  await setLocal($, `${DEMO}a`, { status: 'done', at })
  chime($, true)
}

/** Ends every preview: helpers gone, this chat's mascot asleep. */
async function demoStop($: EngineInterface) {
  await update($, local, list => list.filter(w => !isDemo(w)))
  await setLocal($, MAIN, { status: 'idle' })
}

/** Plays the big sting, then the small one, as they sound with the current options. */
async function testSound($: EngineInterface) {
  chime($, false)
  await $.clock.sleep(1200)
  chime($, true)
}

/**
 * The alert time after a "!", puts this chat's mascot back to sleep and drops a finished
 * subagent; `at` tells this alert from a newer one raised meanwhile.
 */
async function endAlert($: EngineInterface, id: string, at: number) {
  const w = (await read($, local)).find(one => one.id === id)
  if (w?.status !== 'done' || w.at !== at) return
  if (id === MAIN) {
    await setLocal($, MAIN, { status: 'idle' })
    await publish($, 'idle')
  } else {
    await update($, local, list => list.filter(one => one.id !== id))
  }
}

export const register: Register = (on, options) => {
  cfg = readConfig(options)

  on('session.start', async ($, e, next) => {
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    if (home) {
      dir = `${home.replace(/\\/g, '/')}/.claude/laptop-crew`
      file = `${dir}/${await $.session.id()}.json`
      soundDir = `${home.replace(/\\/g, '/')}/.claude/laptop-crew-sounds`
    }
    await setLocal($, MAIN, { label: 'Este chat', status: 'idle' })
    await publish($, 'idle')
    timer?.cancel()
    timer = undefined
    // 0 small mascots: only this chat matters, so nobody else is watched.
    if (cfg.maxSmall > 0) timer = $.clock.every(POLL_MS, () => void poll($).catch(() => {}))
    else await update($, local, list => list.filter(w => w.id === MAIN))
    if (cfg.sound) void prepareSounds($).catch(() => {})
    if (cfg.sound && cfg.volume > 0) void startPlayer($, (await $.session.id()).slice(0, 12)).catch(() => {})
    // The side pane of earlier versions: the mascots live in the band now.
    void $.ui.close({ id: PANE }).catch(() => {})
    await $.command.register({ name: 'crew', description: 'Opciones de las mascotas de laptop-crew' }).catch(() => {})
    return next(e)
  })

  on('command.run', { command: 'crew' }, async $ => {
    const opened = await $.ui.open({ id: OPTIONS, title: 'laptop-crew', focus: true, closeOnEscape: true })
    return { text: opened.isPlaced ? 'Opciones de laptop-crew abiertas.' : `No se pudo abrir el panel: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: OPTIONS }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const close = <Button key="close" label="Cerrar" role="dismiss" onPress={() => $.ui.close({ id: OPTIONS })} />
    if (!('Input' in ui) || !('Select' in ui)) {
      return (
        <Box flexDirection="column">
          <Text>Este panel necesita la app de escritorio o la terminal; aquí cambia las opciones en /config.</Text>
          {close}
        </Box>
      )
    }
    const { Input, Select } = ui
    return (
      <Box flexDirection="column" gap="sm">
        <Text bold>Opciones de las mascotas</Text>
        <Select
          key="sound"
          label="Sonido"
          value={cfg.sound ? 'on' : 'off'}
          options={[{ value: 'on', label: 'Activado' }, { value: 'off', label: 'Desactivado' }]}
          onSelect={v => void saveOption($, 'sound', v === 'on')}
        />
        <Input
          key="alertSeconds"
          label="Duración del ! en segundos (5 a 3600)"
          value={String(cfg.alertMs / 1000)}
          submitLabel="Guardar"
          onSubmit={v => void saveNumber($, 'alertSeconds', v, 5, 3600)}
        />
        <Select
          key="maxSmall"
          label="Mascotas pequeñas (0: solo este chat)"
          value={String(cfg.maxSmall)}
          options={['0', '1', '2', '3'].map(v => ({ value: v, label: v }))}
          onSelect={v => void saveOption($, 'maxSmall', Number(v))}
        />
        <Input
          key="volume"
          label="Volumen general de ambos sonidos (0 a 100)"
          value={String(Math.round(cfg.volume * 100))}
          submitLabel="Guardar"
          onSubmit={v => void saveNumber($, 'volume', v, 0, 100)}
        />
        <Input
          key="smallVolume"
          label="Volumen de las pequeñas (% del general)"
          value={String(Math.round(cfg.smallVolume * 100))}
          submitLabel="Guardar"
          onSubmit={v => void saveNumber($, 'smallVolume', v, 0, 100)}
        />
        <Input
          key="customSound"
          label="Audio propio (.wav; vacío: el incluido)"
          value={cfg.customSound}
          placeholder="C:\ruta\alerta.wav"
          submitLabel="Guardar"
          onSubmit={v => void saveOption($, 'customSound', v.trim().replace(/^"(.*)"$/, '$1'))}
        />
        <Input
          key="mascotColor"
          label="Color de la mascota (hex; vacío: naranja)"
          value={cfg.mascotColor}
          placeholder={MASCOT_COLOR}
          submitLabel="Guardar"
          onSubmit={v => void saveColor($, 'mascotColor', v, MASCOT_COLOR)}
        />
        <Input
          key="laptopColor"
          label="Color de la laptop (hex; vacío: gris)"
          value={cfg.laptopColor}
          placeholder={LAPTOP_COLOR}
          submitLabel="Guardar"
          onSubmit={v => void saveColor($, 'laptopColor', v, LAPTOP_COLOR)}
        />
        <Text bold>Posición</Text>
        <Select
          key="aloneAlign"
          label="Sin nada más en la franja"
          value={cfg.aloneAlign}
          options={[
            { value: 'center', label: 'Centro' },
            { value: 'right', label: 'Derecha' },
            { value: 'left', label: 'Izquierda' },
          ]}
          onSelect={v => void saveOption($, 'aloneAlign', v)}
        />
        <Select
          key="sharedSide"
          label="Junto a otro contenido (ponytail)"
          value={cfg.sharedSide}
          options={[
            { value: 'right', label: 'Derecha' },
            { value: 'left', label: 'Izquierda' },
          ]}
          onSelect={v => void saveOption($, 'sharedSide', v)}
        />
        <Select
          key="miniSide"
          label="Mascotas pequeñas"
          value={cfg.miniSide}
          options={[
            { value: 'left', label: 'A la izquierda de la grande' },
            { value: 'right', label: 'A la derecha de la grande' },
          ]}
          onSelect={v => void saveOption($, 'miniSide', v)}
        />
        <Text bold>Probar animaciones</Text>
        <Box flexDirection="row" gap="sm" flexWrap="wrap">
          <Button key="demoWorking" label="Trabajando" onPress={() => void demoWorking($)} />
          <Button key="demoDone" label="Terminó (!)" onPress={() => void demoDone($)} />
          <Button key="demoCrowd" label="Ayudantes (+N)" onPress={() => void demoCrowd($)} />
          <Button key="demoStop" label="Detener" onPress={() => void demoStop($)} />
        </Box>
        <Input
          key="demoCount"
          label="Probar con esta cantidad de ayudantes (1 a 50)"
          placeholder="5"
          submitLabel="Probar"
          onSubmit={v => void demoCount($, v)}
        />
        <Box flexDirection="row" gap="sm">
          <Button key="test" label="Probar sonido" onPress={() => void testSound($)} />
          {close}
        </Box>
      </Box>
    )
  })

  on('session.end', async ($, e, next) => {
    timer?.cancel()
    await publish($, 'gone')
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // A new prompt means the person saw the result: drop finished subagents.
    await update($, local, list => list.filter(w => w.id === MAIN || w.status !== 'done'))
    return next(e)
  }).catch(($, e, next) => next(e)) // never hold a prompt back over the mascots

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await setLocal($, MAIN, { status: 'working' })
      await publish($, 'working')
    } else if (cfg.maxSmall > 0) {
      const info = (await $.agent.list()).find(a => a.id === e.agentId)
      await setLocal($, e.agentId, { label: info?.description || info?.type || 'subagente', status: 'working' })
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    if (id !== MAIN && cfg.maxSmall === 0) return next(e)
    const status: Worker['status'] = e.reason === 'aborted' ? 'idle' : 'done'
    const at = await $.clock.now()
    await setLocal($, id, { status, at })
    if (id === MAIN) await publish($, status)
    if (status === 'done') chime($, id !== MAIN)
    if (status === 'done') $.clock.after(cfg.alertMs, () => void endAlert($, id, at).catch(() => {}))
    return next(e)
  })

  // The band above the prompt, shared: whatever the plugins beneath draw there
  // (ponytail's menu) stays whole on the left, the mascots sit on the right.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const below = await next(e)
    const mine = await read($, local)
    const main = mine.find(w => w.id === MAIN)
    // Before session.start has seated this chat's mascot there is nothing to draw.
    if (!main) return below
    // Everyone else busy or just finished: subagents first, then other chats; alerts lead.
    const others = [...mine.filter(w => w.id !== MAIN), ...(await read($, chats))]
      .filter(w => w.status !== 'idle')
      .sort((a, b) => Number(b.status === 'done') - Number(a.status === 'done'))
    const shown = others.slice(0, cfg.maxSmall)
    const extra = others.length - shown.length
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const state = (w: Worker) => (w.status === 'done' ? 'terminó' : w.status === 'working' ? 'trabajando' : 'en espera')

    let crew
    if (!('Svg' in ui)) {
      const glyph = (w: Worker) => (w.status === 'done' ? '❗' : w.status === 'working' ? '⌨' : 'z')
      const small = shown.map(w => `${glyph(w)} ${short(w.label)}`).join('  ')
      crew = <Text color={cfg.mascotColor}>{`${small}${extra > 0 ? ` +${extra}` : ''}  ${glyph(main)}`}</Text>
    } else {
      const { Svg } = ui
      const sw = CELL * SMALL
      const sh = HEIGHT * SMALL
      // The minis' column sits on the big mascot's left or right, as the person chose.
      const column = shown.length > 0 ? sw + 4 : 0
      const bigX = cfg.miniSide === 'left' ? column : 0
      const miniX = cfg.miniSide === 'left' ? 0 : CELL + 4
      const smalls = shown
        .map((w, i) => `<g transform="translate(${miniX} ${i * sh}) scale(${SMALL})">${figure(w, 0, 0)}</g>`)
        .join('')
      // "+N" as big as the last small figure, centered over it, when more are busy than fit.
      const badge =
        extra > 0
          ? `<g transform="translate(${miniX + sw / 2} ${(shown.length - 0.5) * sh})">
              <text y="5.5" text-anchor="middle" font-family="Arial Black, sans-serif" font-weight="900" font-size="15" fill="${cfg.mascotColor}"
                stroke="#1A1A1A" stroke-width="2" paint-order="stroke" stroke-linejoin="round">+${extra}</text>
            </g>`
          : ''
      const width = column + CELL
      const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT + PAD}" viewBox="0 ${-PAD} ${width} ${HEIGHT + PAD}">${smalls}${badge}${figure(main, bigX, 0)}</svg>`
      const alt = [`Este chat: ${state(main)}`, ...others.map(w => `${w.label}: ${state(w)}`)].join(', ')
      crew = <Svg source={source} alt={alt} width={width} height={HEIGHT + PAD} isInteractive />
    }

    // The band's frame is the app's and spans the window either way. Alone (ponytail's band hidden
    // or absent; the engine's own node draws nothing and stays in the tree) the mascots take the
    // spot chosen for them; beside other content they keep to the chosen side and it fills the rest.
    if (isEmptyTree(below)) {
      const justify = cfg.aloneAlign === 'left' ? 'flex-start' : cfg.aloneAlign === 'right' ? 'flex-end' : 'center'
      return (
        <Box flexDirection="row" justifyContent={justify}>
          {isEngineNode(below) ? below : null}
          {crew}
        </Box>
      )
    }
    const rest = (
      <Box flexGrow={1} flexShrink={1} flexDirection="column">
        {below}
      </Box>
    )
    return (
      <Box flexDirection="row" alignItems="flex-end" gap="sm">
        {cfg.sharedSide === 'left' ? crew : rest}
        {cfg.sharedSide === 'left' ? rest : crew}
      </Box>
    )
  })
}
