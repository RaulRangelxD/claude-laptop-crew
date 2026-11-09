import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'laptop-crew', component: 'AbovePrompt', surface: 'desktop',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, scroll: { offset: 0, bodyRows: 20 } },
} as never

const agent = (id: string) => ({ id, label: id, status: 'working' })

test('four busy helpers: three small ones and a +1, no label on the big one', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['ponytail'] }) as never)
  on('state.get', (_, e) => {
    const key = (e as unknown as { key: string }).key
    const value = key === 'local'
      ? [{ id: 'main', label: 'Este chat', status: 'working' }, agent('a1'), agent('a2'), agent('a3')]
      : [agent('chat1')]
    return { value: { value, version: 1 } }
  })
  const ui = await $.ui.mount(BAND)
  const svg = (await ui.find({ type: 'Svg' })) as { props: { source: string; alt: string } } | undefined
  await ui.unmount()
  expect(svg?.props.source).toContain('+1</text>')
  expect(svg?.props.source.match(/scale\(0\.333/g)?.length).toBe(3)
  expect(svg?.props.source).not.toContain('Este chat')
  expect(svg?.props.alt.split(', ').length).toBe(5)
})
