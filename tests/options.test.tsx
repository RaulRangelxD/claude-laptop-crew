import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'laptop-crew', component: 'AbovePrompt', surface: 'desktop',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, scroll: { offset: 0, bodyRows: 20 } },
} as never
const DONE = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never
const agent = (id: string) => ({ id, label: id, status: 'working' })

function engine(on: Parameters<Parameters<typeof test>[1]>[1], env: Record<string, string> = {}) {
  const clock = mock.clock(on, { now: 1000 })
  mock.env(on, env)
  const runs: string[][] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.close', () => ({ value: undefined }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['ponytail'] }) as never)
  on('process.run', (_, e) => (runs.push((e as unknown as { argv: string[] }).argv), { value: { exitCode: 0, stdout: 'ok', stderr: '' } }) as never)
  on('audio.play', () => ({ value: undefined }) as never)
  return { clock, runs }
}

test('maxSmall 0: only this chat, even with others busy', { options: { maxSmall: 0 } }, async ($, on) => {
  engine(on)
  on('state.get', (_, e) => {
    const key = (e as unknown as { key: string }).key
    const value = key === 'local' ? [{ id: 'main', label: 'Este chat', status: 'working' }, agent('a1')] : [agent('c1')]
    return { value: { value, version: 1 } }
  })
  const ui = await $.ui.mount(BAND)
  const svg = (await ui.find({ type: 'Svg' })) as { props: { source: string } } | undefined
  await ui.unmount()
  expect(svg?.props.source).not.toContain('scale(0.333')
})

test('alertSeconds 10: the "!" sleeps after ten seconds', { options: { alertSeconds: 10 } }, async ($, on) => {
  const { clock } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(DONE)
  const alt = async () => {
    const ui = await $.ui.mount(BAND)
    const svg = (await ui.find({ type: 'Svg' })) as { props: { alt: string } } | undefined
    await ui.unmount()
    return svg?.props.alt
  }
  await clock.advance(9_000)
  expect(await alt()).toBe('Este chat: terminó')
  await clock.advance(2_000)
  expect(await alt()).toBe('Este chat: en espera')
})

test('sound off: nothing plays', { options: { sound: false } }, async ($, on) => {
  const { runs } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(DONE)
  expect(runs.length).toBe(0)
})

test('an own sound is prepared from its path at the small volume', { options: { customSound: 'C:/sonidos/mio.wav', smallVolume: 20 } }, async ($, on) => {
  const { runs } = engine(on, { USERPROFILE: 'C:/Users/x' })
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: 5, isLink: false } }) as never)
  on('fs.read', () => ({ deny: 'nothing built yet' }) as never)
  on('fs.write', () => ({ value: undefined }) as never)
  on('fs.exists', () => ({ value: false }) as never)
  on('session.id', () => ({ value: 's1' }) as never)
  on('session.root', () => ({ value: 'C:/proj' }) as never)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await new Promise(r => setTimeout(r, 50))
  const prep = runs.find(a => a.some(x => x.endsWith('prepare.ps1')))
  if (!prep) throw new Error(`no prepare call; root=${$.plugin.root} runs=${JSON.stringify(runs)}`)
  expect(prep[prep.indexOf('-Source') + 1]).toBe('C:/sonidos/mio.wav')
  expect(prep[prep.indexOf('-SmallVolume') + 1]).toBe('0.2')
})
