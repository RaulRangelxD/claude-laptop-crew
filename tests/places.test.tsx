import { expect, mock, test } from 'claude-code/testing'

const DONE = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never
const SPINNER = {
  plugin: 'laptop-crew', component: 'Spinner', surface: 'desktop',
  props: { word: 'Pensando', message: null, suffix: '…', mode: 'thinking' },
} as never
const row = (id: string) =>
  ({ plugin: 'laptop-crew', component: 'Placed', surface: 'desktop', props: { id, plugin: 'laptop-crew' } }) as never

function engine(on: Parameters<Parameters<typeof test>[1]>[1]) {
  const clock = mock.clock(on, { now: 1000 })
  mock.env(on, {})
  const placed: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.close', () => ({ value: undefined }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('audio.play', () => ({ value: undefined }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
  on('ui.place', (_, e) => (placed.push((e as unknown as { id: string }).id), { value: { isPlaced: true, requestId: 'r' } }) as never)
  on('ui.render', { component: 'Spinner' }, () => ({ type: 'Text', props: {}, children: ['Pensando…'] }) as never)
  on('ui.render', { component: 'Placed' }, () => ({ type: 'Box', props: {}, children: [] }) as never)
  return { clock, placed }
}

async function svgOf($: Parameters<Parameters<typeof test>[1]>[0], target: never) {
  const ui = await $.ui.mount(target)
  const svg = (await ui.find({ type: 'Svg' })) as { props: { alt: string } } | undefined
  const text = await ui.find({ type: 'Text', text: /Pensando/ })
  await ui.unmount()
  return { alt: svg?.props.alt, keepsEngine: text !== undefined }
}

test('the working indicator gets a mini mascot beside its own line', async ($, on) => {
  engine(on)
  const got = await svgOf($, SPINNER)
  expect(got.alt).toBe('Claude trabajando')
  expect(got.keepsEngine).toBe(true)
})

test('spinner off: the indicator is the engine own', { options: { spinner: false } }, async ($, on) => {
  engine(on)
  expect((await svgOf($, SPINNER)).alt).toBeUndefined()
})

test('a finished turn places the "!" row, which empties once the alert is over', async ($, on) => {
  const { clock, placed } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(DONE)
  expect(placed).toEqual(['done-1000'])
  expect((await svgOf($, row('done-1000'))).alt).toBe('Claude terminó')
  await clock.advance(61_000)
  expect((await svgOf($, row('done-1000'))).alt).toBeUndefined()
})

test('endRow off: no row is placed', { options: { endRow: false } }, async ($, on) => {
  const { placed } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(DONE)
  expect(placed).toEqual([])
})

test('band off: the band is left to what is beneath', { options: { band: false } }, async ($, on) => {
  engine(on)
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['ponytail'] }) as never)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'laptop-crew', component: 'AbovePrompt', surface: 'desktop',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, scroll: { offset: 0, bodyRows: 20 } },
  } as never)
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})


const PANE = {
  plugin: 'laptop-crew', component: 'Pane', requestId: 'crew-options', surface: 'desktop',
  props: { title: 'laptop-crew', isFocused: true, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as never

test('the panel previews the "!" row where the app draws placed rows', async ($, on) => {
  const { placed } = engine(on)
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'demoEndRow' })
  expect((await svgOf($, row(placed[0]! as string) as never)).alt).toBe('Claude terminó')
  await pane.unmount()
})

test('where the app draws no placed rows (desktop today) the preview says so', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
  on('ui.place', () => ({ value: { isPlaced: false, reason: 'no attached surface draws placed rows yet' } }) as never)
  const toasts: string[] = []
  on('ui.toast', (_, e) => (toasts.push(JSON.stringify(e)), { value: undefined }) as never)
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'demoEndRow' })
  await pane.unmount()
  expect(toasts.join()).toContain('todavía no muestra filas')
})
