import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'laptop-crew', component: 'AbovePrompt', surface: 'desktop',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, scroll: { offset: 0, bodyRows: 20 } },
} as never

function seed(on: Parameters<Parameters<typeof test>[1]>[1], beneath: unknown) {
  on('ui.render', { component: 'AbovePrompt' }, () => beneath as never)
  on('state.get', (_, e) => {
    const key = (e as unknown as { key: string }).key
    const value = key === 'local'
      ? [{ id: 'main', label: 'Este chat', status: 'working' }, { id: 'a1', label: 'a1', status: 'working' }]
      : []
    return { value: { value, version: 1 } }
  })
}

for (const [aloneAlign, justify] of [['left', 'flex-start'], ['right', 'flex-end'], ['center', 'center']] as const) {
  test(`alone, aloneAlign ${aloneAlign} puts the mascots ${justify}`, { options: { aloneAlign } }, async ($, on) => {
    seed(on, { type: 'engine', ref: 1 })
    const ui = await $.ui.mount(BAND)
    const root = (await ui.find({ type: 'Box' })) as { props: Record<string, unknown> } | undefined
    await ui.unmount()
    expect(root?.props.justifyContent).toBe(justify)
  })
}

test('beside ponytail, sharedSide left puts the mascots first and ponytail after', { options: { sharedSide: 'left' } }, async ($, on) => {
  seed(on, { type: 'Text', props: {}, children: ['ponytail'] })
  const ui = await $.ui.mount(BAND)
  const root = (await ui.find({ type: 'Box' })) as { children: { type: string }[] } | undefined
  await ui.unmount()
  expect(root?.children.map(c => c.type)).toEqual(['Svg', 'Box'])
})

test('miniSide right draws the minis after the big mascot', { options: { miniSide: 'right' } }, async ($, on) => {
  seed(on, { type: 'engine', ref: 1 })
  const ui = await $.ui.mount(BAND)
  const svg = (await ui.find({ type: 'Svg' })) as { props: { source: string } } | undefined
  await ui.unmount()
  expect(svg?.props.source).toContain('translate(88 0) scale(0.333')
})

test('the panel saves the three placements', async ($, on) => {
  const sets: { key: string; value: unknown }[] = []
  on('config.set', (_, e) => (sets.push({ key: e.key, value: e.value }), { value: e.value }) as never)
  const ui = await $.ui.mount({
    plugin: 'laptop-crew', component: 'Pane', requestId: 'crew-options', surface: 'desktop',
    props: { title: 'laptop-crew', isFocused: true, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as never)
  await ui.select({ key: 'aloneAlign', value: 'left' })
  await ui.select({ key: 'sharedSide', value: 'left' })
  await ui.select({ key: 'miniSide', value: 'right' })
  await ui.unmount()
  expect(sets).toEqual([
    { key: 'laptop-crew.aloneAlign', value: 'left' },
    { key: 'laptop-crew.sharedSide', value: 'left' },
    { key: 'laptop-crew.miniSide', value: 'right' },
  ])
})
