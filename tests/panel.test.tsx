import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'laptop-crew', component: 'Pane', requestId: 'crew-options', surface: 'desktop',
  props: { title: 'laptop-crew', isFocused: true, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as never

test('the /crew panel saves each option through /config', async ($, on) => {
  const sets: { key: string; value: unknown }[] = []
  on('config.set', (_, e) => (sets.push({ key: e.key, value: e.value }), { value: e.value }) as never)
  const toasts: string[] = []
  on('ui.toast', (_, e) => (toasts.push(JSON.stringify(e)), { value: undefined }) as never)
  const ui = await $.ui.mount(PANE)
  await ui.select({ key: 'maxSmall', value: '0' })
  await ui.select({ key: 'sound', value: 'off' })
  await ui.input({ key: 'smallVolume', text: '250', kind: 'submit' } as never)
  await ui.input({ key: 'alertSeconds', text: 'abc', kind: 'submit' } as never)
  await ui.input({ key: 'customSound', text: '"C:/mis sonidos/a.wav"', kind: 'submit' } as never)
  await ui.unmount()
  expect(sets).toEqual([
    { key: 'laptop-crew.maxSmall', value: 0 },
    { key: 'laptop-crew.sound', value: false },
    { key: 'laptop-crew.smallVolume', value: 100 },
    { key: 'laptop-crew.customSound', value: 'C:/mis sonidos/a.wav' },
  ])
  expect(toasts.join()).toContain('no es un número')
})

test('colors: a hex is saved in full, empty restores the default, anything else is refused', async ($, on) => {
  const sets: { key: string; value: unknown }[] = []
  on('config.set', (_, e) => (sets.push({ key: e.key, value: e.value }), { value: e.value }) as never)
  const toasts: string[] = []
  on('ui.toast', (_, e) => (toasts.push(JSON.stringify(e)), { value: undefined }) as never)
  const ui = await $.ui.mount(PANE)
  await ui.input({ key: 'mascotColor', text: '3a7', kind: 'submit' } as never)
  await ui.input({ key: 'laptopColor', text: '', kind: 'submit' } as never)
  await ui.input({ key: 'laptopColor', text: 'rojo', kind: 'submit' } as never)
  await ui.unmount()
  expect(sets).toEqual([
    { key: 'laptop-crew.mascotColor', value: '#33AA77' },
    { key: 'laptop-crew.laptopColor', value: '#C9C9C9' },
  ])
  expect(toasts.join()).toContain('no es un color')
})

test('the chosen colors reach the drawing', { options: { mascotColor: '#112233', laptopColor: '#445566' } }, async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['x'] }) as never)
  on('state.get', (_, e) => {
    const key = (e as unknown as { key: string }).key
    return { value: { value: key === 'local' ? [{ id: 'main', label: 'Este chat', status: 'done' }] : [], version: 1 } }
  })
  const ui = await $.ui.mount({
    plugin: 'laptop-crew', component: 'AbovePrompt', surface: 'desktop',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, scroll: { offset: 0, bodyRows: 20 } },
  } as never)
  const svg = (await ui.find({ type: 'Svg' })) as { props: { source: string } } | undefined
  await ui.unmount()
  expect(svg?.props.source).toContain('fill="#112233"')
  expect(svg?.props.source).toContain('fill="#445566"')
  expect(svg?.props.source).not.toContain('#D97757')
})

test('the preview buttons drive the band: working, the "!", helpers with +N, then stop', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
  on('audio.play', () => ({ value: undefined }) as never)
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['x'] }) as never)
  const band = async () => {
    const ui = await $.ui.mount({
      plugin: 'laptop-crew', component: 'AbovePrompt', surface: 'desktop',
      props: { hasSurvey: false, isWorking: false, maxRows: 20, scroll: { offset: 0, bodyRows: 20 } },
    } as never)
    const svg = (await ui.find({ type: 'Svg' })) as { props: { alt: string; source: string } } | undefined
    await ui.unmount()
    return svg?.props
  }
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'demoWorking' })
  expect((await band())?.alt).toBe('Este chat: trabajando')
  await pane.press({ key: 'demoDone' })
  expect((await band())?.alt).toBe('Este chat: terminó')
  await pane.press({ key: 'demoCrowd' })
  const crowd = await band()
  expect(crowd?.source).toContain('+2</text>')
  expect(crowd?.alt.split(', ').length).toBe(6)
  await pane.press({ key: 'demoStop' })
  expect((await band())?.alt).toBe('Este chat: en espera')
  await pane.unmount()
})

test('the helper count field previews that many: 2 shows two smalls and no +N, 7 shows a +4', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['x'] }) as never)
  const toasts: string[] = []
  on('ui.toast', (_, e) => (toasts.push(JSON.stringify(e)), { value: undefined }) as never)
  const band = async () => {
    const ui = await $.ui.mount({
      plugin: 'laptop-crew', component: 'AbovePrompt', surface: 'desktop',
      props: { hasSurvey: false, isWorking: false, maxRows: 20, scroll: { offset: 0, bodyRows: 20 } },
    } as never)
    const svg = (await ui.find({ type: 'Svg' })) as { props: { source: string } } | undefined
    await ui.unmount()
    return svg?.props.source ?? ''
  }
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'demoStop' }) // seats this chat's mascot, as session.start does
  await pane.input({ key: 'demoCount', text: '2', kind: 'submit' } as never)
  const two = await band()
  expect(two.match(/scale\(0\.333/g)?.length).toBe(2)
  expect(two).not.toMatch(/\+\d+<\/text>/)
  await pane.input({ key: 'demoCount', text: '7', kind: 'submit' } as never)
  expect(await band()).toContain('+4</text>')
  await pane.input({ key: 'demoCount', text: 'muchos', kind: 'submit' } as never)
  expect(toasts.join()).toContain('no es una cantidad')
  await pane.unmount()
})
