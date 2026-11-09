import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'laptop-crew', component: 'Pane', requestId: 'crew-options', surface: 'desktop',
  props: { title: 'laptop-crew', isFocused: true, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as never

test('with no /config row (the desktop app) an option is kept in the store, applied, and set again through /config once it has one', async ($, on) => {
  let hasRow = false
  on('config.set', (_, e) => {
    if (!hasRow) throw new Error(`$.config.set: no /config row with key ${e.key}`)
    return { value: e.value } as never
  })
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }) as never)
  on('store.set', (_, e) => (store.set((e as { key: string }).key, (e as { value: unknown }).value), { value: undefined }) as never)
  const toasts: string[] = []
  on('ui.toast', (_, e) => (toasts.push(JSON.stringify(e)), { value: undefined }) as never)
  const ui = await $.ui.mount(PANE)
  await ui.select({ key: 'band', value: 'off' })
  await ui.select({ key: 'spinner', value: 'off' })
  expect(toasts).toEqual([])
  expect(store.get('options')).toEqual({ band: false, spinner: false })
  hasRow = true
  await ui.select({ key: 'band', value: 'on' })
  await ui.unmount()
  expect(store.get('options')).toEqual({ spinner: false })
})
