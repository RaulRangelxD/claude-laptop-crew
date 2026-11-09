import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { Worker } from '../types'
import { fromBase64, pitchWav, toBase64 } from './wav'

const local = atom({ plugin: 'laptop-crew', key: 'local' } as const, [] as Worker[])
const doneRow = atom({ plugin: 'laptop-crew', key: 'doneRow' } as const, null as string | null)
const demoRow = atom({ plugin: 'laptop-crew', key: 'demoRow' } as const, null as { id: string; kind: 'working' | 'done' } | null)

const PANE = 'crew'
const MAIN = 'main'
const MASCOT_COLOR = '#D97757'
const LAPTOP_COLOR = '#C9C9C9'
/** One figure's box: 84 wide, 64 tall, the "!" kept inside it (top) down to the laptop's base. */
const CELL = 84
const HEIGHT = 64
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
  /** Compact: this chat as a mini mascot and everyone else as one number beside it. */
  compact: boolean
  /** Where the mascots show: the band above the prompt, the working indicator, a "!" row at the end of the chat. */
  band: boolean
  spinner: boolean
  endRow: boolean
  /** The side pane on the right, as in the first version. */
  pane: boolean
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
    compact: o.compact === true,
    band: o.band !== false,
    spinner: o.spinner !== false,
    endRow: o.endRow !== false,
    pane: o.pane === true,
  }
}

// Module state: starts over on a hot reload, which register and session.start set up again.
let cfg = readConfig({})
/** The options from settings, as register got them; `$.store`'s OVERRIDES go over them. */
let baseOptions: PluginOptions = {}
/** Options saved where the session has no /config row for the mod (the desktop app). */
const OVERRIDES = 'options'
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
    ? `<g transform="translate(${x + 42} ${y + 21})"><g transform="scale(0)">
          <animateTransform attributeName="transform" type="scale" values="0;1.15;1" keyTimes="0;0.6;1" dur="0.35s" begin="0.4s" fill="freeze"/>
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
  let row: { key: string } | undefined
  try {
    // The row's key as the menu names it: loaded from a plugin folder it can be `laptop-crew@inline.<field>`.
    const name = $.plugin.name
    const rows = await $.config.list().catch(() => [])
    row =
      rows.find(r => r.key === `${name}.${field}`) ??
      rows.find(r => r.key.endsWith(`.${field}`) && r.key.split('.')[0]!.split('@')[0] === name.split('@')[0])
    const result = await $.config.set({ key: row?.key ?? `${name}.${field}`, value })
    if ('deny' in result && result.deny) {
      if (!row) return await saveOverride($, field, value)
      $.ui.toast(`laptop-crew: no se pudo guardar ${field}: ${result.deny}`)
      return
    }
    // Saved in settings: an older override must not shadow it.
    await dropOverride($, field)
  } catch (err) {
    // The desktop app lists no /config rows for a mod loaded from a folder: keep it in the mod's store.
    if (!row) return await saveOverride($, field, value).catch(e => $.ui.toast(`laptop-crew: error al guardar ${field}: ${String(e)}`))
    $.ui.toast(`laptop-crew: error al guardar ${field}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function readOverrides($: EngineInterface): Promise<PluginOptions> {
  const saved = await $.store.get(OVERRIDES)
  return saved && typeof saved === 'object' ? (saved as PluginOptions) : {}
}

/** Keeps one option in `$.store` and applies it now, as a /config change's reload would. */
async function saveOverride($: EngineInterface, field: string, value: string | number | boolean) {
  const next = { ...(await readOverrides($)), [field]: value }
  await $.store.set(OVERRIDES, next)
  cfg = readConfig({ ...baseOptions, ...next })
  if (field === 'maxSmall' && cfg.maxSmall === 0) await update($, local, list => list.filter(w => w.id === MAIN))
  if ((field === 'sound' || field === 'customSound' || field === 'volume' || field === 'smallVolume') && cfg.sound) {
    void prepareSounds($).catch(() => {})
  }
  $.ui.invalidate('ui.render')
}

async function dropOverride($: EngineInterface, field: string) {
  const saved = await readOverrides($).catch(() => ({}) as PluginOptions)
  if (!(field in saved)) return
  const { [field]: _, ...rest } = saved
  await $.store.set(OVERRIDES, rest)
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

// Previews for the /crew panel: they change only this window's mascots.
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
  await placeDoneRow($, at)
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
/** One figure as its own drawing: full size, or a mini when `small` (the working indicator, compact mode). */
function figureSvg(w: Worker, small: boolean): { source: string; width: number; height: number } {
  const width = Math.round(small ? CELL * SMALL : CELL)
  const height = Math.round(small ? HEIGHT * SMALL : HEIGHT)
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${CELL} ${HEIGHT}">${figure(w, 0, 0)}</svg>`,
    width,
    height,
  }
}

/**
 * Puts this chat's "!" in a row at the end of the conversation, which shows while the "!" lasts.
 * Where the surface draws no placed rows (the desktop app, as of Claude Code 2.1.317) it answers
 * isPlaced false and nothing shows; the band's "!" stays the alert there.
 */
async function placeDoneRow($: EngineInterface, at: number) {
  if (!cfg.endRow) return
  const id = `done-${at}`
  await update($, doneRow, () => id)
  await $.ui.place({ id }).catch(() => undefined)
}

/** Previews the "!" row (for the alert time); says so where the app draws no such rows. */
async function demoRowPreview($: EngineInterface, kind: 'working' | 'done') {
  const id = `demo-${kind}-${await $.clock.now()}`
  await update($, demoRow, () => ({ id, kind }))
  const placed = await $.ui.place({ id }).catch(() => ({ isPlaced: false as const, reason: 'error' }))
  if (!placed.isPlaced) $.ui.toast('laptop-crew: esta app todavía no muestra filas de mods en el chat')
  if (kind === 'done') chime($, false)
  $.clock.after(kind === 'done' ? cfg.alertMs : 10_000, () =>
    void update($, demoRow, row => (row?.id === id ? null : row)).catch(() => {}),
  )
}

async function demoStop($: EngineInterface) {
  await update($, demoRow, () => null)
  await update($, local, list => list.filter(w => !isDemo(w)))
  await setLocal($, MAIN, { status: 'idle' })
}

/** Plays the big sting, then the small one, as they sound with the current options. */
async function testSound($: EngineInterface) {
  chime($, false)
  await $.clock.sleep(1200)
  chime($, true)
}

/** This chat's mascot, and its subagents busy or just finished, alerts first. */
function crewOf(mine: Worker[]): { main: Worker | undefined; others: Worker[] } {
  const others = mine
    .filter(w => w.id !== MAIN && w.status !== 'idle')
    .sort((a, b) => Number(b.status === 'done') - Number(a.status === 'done'))
  return { main: mine.find(w => w.id === MAIN), others }
}

const stateWord = (w: Worker) => (w.status === 'done' ? 'terminó' : w.status === 'working' ? 'trabajando' : 'en espera')

/** The crew as one line of glyphs, for a surface that draws no SVG. */
function crewText(main: Worker, others: Worker[]): string {
  const glyph = (w: Worker) => (w.status === 'done' ? '❗' : w.status === 'working' ? '⌨' : 'z')
  const shown = others.slice(0, cfg.maxSmall)
  const extra = others.length - shown.length
  const small = shown.map(w => `${glyph(w)} ${short(w.label)}`).join('  ')
  return `${small}${extra > 0 ? ` +${extra}` : ''}  ${glyph(main)}`
}

/** The crew as one drawing, the same in the band and the side pane: normal or compact, as the person chose. */
function crewArt(main: Worker, others: Worker[]): { source: string; alt: string; width: number; height: number } {
  if (cfg.compact) {
    // Compact: this chat as a mini, everyone else as one number on the minis' side (red when one finished).
    const mw = CELL * SMALL
    const tall = HEIGHT * SMALL
    const numW = others.length > 0 ? 6 + 9 * String(others.length).length : 0
    const mainX = cfg.miniSide === 'left' ? numW : 0
    const numX = cfg.miniSide === 'left' ? numW / 2 : mw + numW / 2
    const anyDone = others.some(w => w.status === 'done')
    const count =
      others.length > 0
        ? `<text x="${numX}" y="${tall / 2 + 5}" text-anchor="middle" font-family="Arial Black, sans-serif" font-weight="900" font-size="14"
            fill="${anyDone ? '#E5322D' : cfg.mascotColor}" stroke="#1A1A1A" stroke-width="2" paint-order="stroke" stroke-linejoin="round">${others.length}</text>`
        : ''
    const width = Math.ceil(mw + numW)
    const height = Math.ceil(tall)
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${tall}"><g transform="translate(${mainX} 0) scale(${SMALL})">${figure(main, 0, 0)}</g>${count}</svg>`
    const alt = [`Este chat: ${stateWord(main)}`, others.length > 0 ? `${others.length} más ocupados` : ''].filter(Boolean).join(', ')
    return { source, alt, width, height }
  }
  const shown = others.slice(0, cfg.maxSmall)
  const extra = others.length - shown.length
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
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}">${smalls}${badge}${figure(main, bigX, 0)}</svg>`
  const alt = [`Este chat: ${stateWord(main)}`, ...others.map(w => `${w.label}: ${stateWord(w)}`)].join(', ')
  return { source, alt, width, height: HEIGHT }
}

/** Opens or closes the side pane that shows the crew, as the `pane` option says. */
async function showPane($: EngineInterface, isOn: boolean) {
  if (isOn) await $.ui.open({ id: PANE, title: 'laptop-crew' })
  else await $.ui.close({ id: PANE })
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
  } else {
    await update($, local, list => list.filter(one => one.id !== id))
  }
}

export const register: Register = (on, options) => {
  baseOptions = options
  cfg = readConfig(options)

  on('session.start', async ($, e, next) => {
    const saved = await $.store.get(OVERRIDES).catch(() => undefined)
    if (saved && typeof saved === 'object') cfg = readConfig({ ...baseOptions, ...(saved as PluginOptions) })
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    if (home) {
      soundDir = `${home.replace(/\\/g, '/')}/.claude/laptop-crew-sounds`
    }
    await setLocal($, MAIN, { label: 'Este chat', status: 'idle' })
    if (cfg.maxSmall === 0) await update($, local, list => list.filter(w => w.id === MAIN))
    if (cfg.sound) void prepareSounds($).catch(() => {})
    if (cfg.sound && cfg.volume > 0) void startPlayer($, (await $.session.id()).slice(0, 12)).catch(() => {})
    void showPane($, cfg.pane).catch(() => {})
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
        <Select
          key="compact"
          label="Tamaño"
          value={cfg.compact ? 'compact' : 'normal'}
          options={[
            { value: 'normal', label: 'Normal' },
            { value: 'compact', label: 'Compacto (mascota pequeña y un número)' },
          ]}
          onSelect={v => void saveOption($, 'compact', v === 'compact')}
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
        <Text bold>Dónde se muestran</Text>
        {(
          [
            ['band', 'En la franja de encima del prompt', cfg.band],
            ['spinner', 'En el indicador de trabajo (mascota pequeña tecleando)', cfg.spinner],
            ['endRow', 'Fila con el ! al final del chat (la app de escritorio aún no la muestra)', cfg.endRow],
            ['pane', 'En el panel lateral de la derecha', cfg.pane],
          ] as const
        ).map(([field, label, isOn]) => (
          <Select
            key={field}
            label={label}
            value={isOn ? 'on' : 'off'}
            options={[
              { value: 'on', label: 'Activado' },
              { value: 'off', label: 'Desactivado' },
            ]}
            onSelect={v => {
              void saveOption($, field, v === 'on')
              if (field === 'pane') void showPane($, v === 'on').catch(() => {})
            }}
          />
        ))}
        <Text bold>Probar animaciones</Text>
        <Box flexDirection="row" gap="sm" flexWrap="wrap">
          <Button key="demoWorking" label="Trabajando" onPress={() => void demoWorking($)} />
          <Button key="demoDone" label="Terminó (!)" onPress={() => void demoDone($)} />
          <Button key="demoCrowd" label="Ayudantes (+N)" onPress={() => void demoCrowd($)} />
          <Button key="demoStop" label="Detener" onPress={() => void demoStop($)} />
        </Box>
        <Box flexDirection="row" gap="sm" flexWrap="wrap">
          <Button key="demoEndRow" label="Probar fila del !" onPress={() => void demoRowPreview($, 'done')} />
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

  on('prompt.submit', async ($, e, next) => {
    // A new prompt means the person saw the result: drop finished subagents.
    await update($, local, list => list.filter(w => w.id === MAIN || w.status !== 'done'))
    return next(e)
  }).catch(($, e, next) => next(e)) // never hold a prompt back over the mascots

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await setLocal($, MAIN, { status: 'working' })
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
    if (status === 'done') chime($, id !== MAIN)
    if (status === 'done') $.clock.after(cfg.alertMs, () => void endAlert($, id, at).catch(() => {}))
    if (status === 'done' && id === MAIN) await placeDoneRow($, at)
    return next(e)
  })

  // The working indicator: a mini mascot typing beside the engine's own line, while a turn runs.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const own = await next(e)
    if (!cfg.spinner) return own
    const ui = $.ui.resolve(e)
    if (!('Svg' in ui)) return own
    const { Box, Svg } = ui
    const art = figureSvg({ id: MAIN, label: '', status: 'working' }, true)
    // The desktop app shows this while thinking or responding; while a tool runs it draws the
    // indicator its own way and the mascot is not shown (seen in Claude Code 2.1.317).
    return (
      <Box flexDirection="row" alignItems="center" gap="sm">
        <Svg source={art.source} alt="Claude trabajando" width={art.width} height={art.height} isInteractive />
        {own}
      </Box>
    )
  })

  // The side pane: the same crew as the band, centered, on its own.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const { main, others } = crewOf(await read($, local))
    if (!main) return <Box />
    if (!('Svg' in ui)) return <Text color={cfg.mascotColor}>{crewText(main, others)}</Text>
    const { Svg } = ui
    const art = crewArt(main, others)
    return (
      <Box flexDirection="row" justifyContent="center">
        <Svg source={art.source} alt={art.alt} width={art.width} height={art.height} isInteractive />
      </Box>
    )
  })

  // The rows this mod placed in the conversation: the latest "!" while it lasts, or a panel preview.
  on('ui.render', { component: 'Placed' }, async ($, e, next) => {
    if (e.props.plugin !== $.plugin.name) return next(e)
    const demo = await read($, demoRow)
    const main = (await read($, local)).find(w => w.id === MAIN)
    let shown: Worker | undefined
    if (demo?.id === e.props.id) shown = { id: MAIN, label: '', status: demo.kind, at: 0 }
    else if (e.props.id === (await read($, doneRow)) && main?.status === 'done') shown = main
    // An older row, or one whose "!" is over, draws nothing: no trail of mascots up the conversation.
    if (!shown) return next(e)
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    if (!('Svg' in ui)) {
      return <Text color={cfg.mascotColor}>{shown.status === 'done' ? '❗ Claude terminó' : '⌨ Claude trabajando…'}</Text>
    }
    const { Svg } = ui
    // The working preview stands for the indicator, so it is drawn at the indicator's mini size.
    const art = figureSvg(shown, shown.status === 'working' || cfg.compact)
    return (
      <Box flexDirection="row" alignItems="center" gap="sm">
        <Svg source={art.source} alt={shown.status === 'done' ? 'Claude terminó' : 'Claude trabajando'} width={art.width} height={art.height} isInteractive />
        {shown.status === 'working' ? <Text dimColor>Así se verá el indicador mientras trabajo</Text> : null}
      </Box>
    )
  })

  // The band above the prompt, shared: whatever the plugins beneath draw there
  // (ponytail's menu) stays whole on the left, the mascots sit on the right.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !cfg.band) return next(e)
    const below = await next(e)
    const { main, others } = crewOf(await read($, local))
    // Before session.start has seated this chat's mascot there is nothing to draw.
    if (!main) return below
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui

    let crew
    if (!('Svg' in ui)) {
      crew = <Text color={cfg.mascotColor}>{crewText(main, others)}</Text>
    } else {
      const { Svg } = ui
      const art = crewArt(main, others)
      crew = <Svg source={art.source} alt={art.alt} width={art.width} height={art.height} isInteractive />
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
