import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'laptop-crew', component: 'AbovePrompt', surface: 'desktop',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, scroll: { offset: 0, bodyRows: 20 } },
} as never

test('the "!" lasts a minute, then the mascot sleeps again', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.env(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.close', () => ({ value: undefined }) as never)
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['ponytail'] }) as never)
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)

  const alt = async () => {
    const ui = await $.ui.mount(BAND)
    const svg = (await ui.find({ type: 'Svg' })) as { props: { alt: string } } | undefined
    await ui.unmount()
    return svg?.props.alt
  }
  expect(await alt()).toBe('Este chat: terminó')
  await clock.advance(59_000)
  expect(await alt()).toBe('Este chat: terminó')
  await clock.advance(2_000)
  expect(await alt()).toBe('Este chat: en espera')
})

test('this chat chimes at full volume, a subagent softer with the small sound', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.env(on, {})
  const plays: unknown[] = []
  on('audio.play', (_, e) => (plays.push(e), { value: undefined }) as never)
  // On Windows the sound goes through PowerShell's SoundPlayer instead.
  on('process.run', (_, e) => (plays.push(e), { value: { exitCode: 0, stdout: '', stderr: '' } }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.close', () => ({ value: undefined }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('agent.list', () => ({ value: [] }) as never)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer', agentId: 'a1' } as never)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't3', reason: 'aborted' } as never)

  expect(JSON.stringify(plays)).toContain('alert.wav')
  expect(JSON.stringify(plays)).toContain('alert-small.wav')
  expect(plays.length).toBe(2)
})
