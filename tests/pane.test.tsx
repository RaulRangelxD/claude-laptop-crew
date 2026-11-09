import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'laptop-crew', component: 'Pane', surface: 'desktop', requestId: 'crew',
  props: { title: 'laptop-crew', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as never

/** Starts a session and returns which panes it opened and closed. */
async function start($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1]) {
  const opened: string[] = []
  const closed: string[] = []
  mock.env(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
  on('session.id', () => ({ value: 's1' }) as never)
  on('ui.open', (_, e) => (opened.push((e as unknown as { id: string }).id), { value: { isPlaced: true } }) as never)
  on('ui.close', (_, e) => (closed.push((e as unknown as { id: string }).id), { value: undefined }) as never)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await new Promise(r => setTimeout(r, 20))
  return { opened, closed }
}

test('pane on: the side pane opens at start', { options: { pane: true } }, async ($, on) => {
  const { opened } = await start($, on)
  expect(opened).toContain('crew')
})

test('pane off (the default): the side pane is closed at start, never opened', async ($, on) => {
  const { opened, closed } = await start($, on)
  expect(opened).not.toContain('crew')
  expect(closed).toContain('crew')
})

test('the side pane draws the same crew as the band', async ($, on) => {
  on('state.get', (_, e) => {
    const key = (e as unknown as { key: string }).key
    const value = key === 'local' ? [{ id: 'main', label: 'Este chat', status: 'done' }, { id: 'a1', label: 'a1', status: 'working' }] : null
    return { value: { value, version: 1 } }
  })
  const ui = await $.ui.mount(PANE)
  const svg = (await ui.find({ type: 'Svg' })) as { props: { alt: string } } | undefined
  await ui.unmount()
  expect(svg?.props.alt).toBe('Este chat: terminó, a1: trabajando')
})
