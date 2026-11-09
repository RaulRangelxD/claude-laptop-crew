import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'laptop-crew', component: 'AbovePrompt', surface: 'desktop',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, scroll: { offset: 0, bodyRows: 20 } },
} as never
const busy = (id: string, status = 'working') => ({ id, label: id, status })

async function draw($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], others: object[]) {
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 1 }) as never)
  on('state.get', (_, e) => {
    const key = (e as unknown as { key: string }).key
    return { value: { value: key === 'local' ? [busy('main'), ...others] : [], version: 1 } }
  })
  const ui = await $.ui.mount(BAND)
  const svg = (await ui.find({ type: 'Svg' })) as { props: { source: string; height: number; alt: string } } | undefined
  await ui.unmount()
  return svg!.props
}

test('compact: this chat as a mini and the rest as one number, in a band a third as tall', { options: { compact: true } }, async ($, on) => {
  const svg = await draw($, on, [busy('a'), busy('b'), busy('c'), busy('d')])
  expect(svg.height).toBeLessThan(30)
  expect(svg.source.match(/scale\(0\.333/g)?.length).toBe(1)
  expect(svg.source).toMatch(/>4<\/text>/)
  expect(svg.alt).toBe('Este chat: trabajando, 4 más ocupados')
})

test('compact: a finished helper turns the number red', { options: { compact: true } }, async ($, on) => {
  const svg = await draw($, on, [busy('a'), busy('b', 'done')])
  expect(svg.source).toContain('fill="#E5322D"')
})

test('compact with nobody else: just the mini, no number', { options: { compact: true } }, async ($, on) => {
  const svg = await draw($, on, [])
  expect(svg.source).not.toMatch(/>\d+<\/text>/)
})
