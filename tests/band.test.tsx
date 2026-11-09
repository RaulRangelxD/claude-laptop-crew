import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'laptop-crew', component: 'AbovePrompt', surface: 'desktop',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, scroll: { offset: 0, bodyRows: 20 } },
} as never

test('the band keeps what is beneath it and adds the mascots', async ($, on) => {
  // Stands for ponytail's menu, drawn beneath this mod.
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['ponytail menu'] }) as never)
  on('state.get', () => ({ value: { value: [{ id: 'main', label: 'Este chat', status: 'done' }], version: 1 } }))
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /ponytail menu/ })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()
})

test('with no mascot yet the band is left as it was', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['ponytail menu'] }) as never)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /ponytail menu/ })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})
