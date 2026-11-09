import { expect, test } from 'claude-code/testing'

test('with nothing else in the band, only the mascots are drawn: no stretching filler', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('state.get', (_, e) => {
    const key = (e as unknown as { key: string }).key
    return { value: { value: key === 'local' ? [{ id: 'main', label: 'Este chat', status: 'working' }] : [], version: 1 } }
  })
  const ui = await $.ui.mount({
    plugin: 'laptop-crew', component: 'AbovePrompt', surface: 'desktop',
    props: { hasSurvey: false, isWorking: true, maxRows: 20, scroll: { offset: 0, bodyRows: 20 } },
  } as never)
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  const root = (await ui.find({ type: 'Box' })) as { props: Record<string, unknown> } | undefined
  expect(root?.props.justifyContent).toBe('center')
  expect(root?.props.flexGrow).toBeUndefined()
  await ui.unmount()
})

test('with only the engine own node beneath (ponytail hidden), the band is not stretched', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 1 }) as never)
  on('state.get', (_, e) => {
    const key = (e as unknown as { key: string }).key
    return { value: { value: key === 'local' ? [{ id: 'main', label: 'Este chat', status: 'working' }] : [], version: 1 } }
  })
  const ui = await $.ui.mount({
    plugin: 'laptop-crew', component: 'AbovePrompt', surface: 'desktop',
    props: { hasSurvey: false, isWorking: true, maxRows: 20, scroll: { offset: 0, bodyRows: 20 } },
  } as never)
  const root = (await ui.find({ type: 'Box' })) as { props: Record<string, unknown> } | undefined
  expect(root?.props.justifyContent).toBe('center')
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()
})
