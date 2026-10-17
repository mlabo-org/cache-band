import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 160,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const
const USAGE = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

const JSON_OUT =
  '{"session":{"cache_read":96,"cache_write":2,"found":true,"input":100,"output":1,"partial":false},' +
  '"window":{"cache_read":97,"cache_write":1,"input":100,"output":1,"partial":false},"window_minutes":60}'

const FRENCH = {
  lastTurn: 'dernier', session: 'session', window: 'tout {minutes} min', read: 'lu', write: 'écrit',
  outdated: 'session/tout -- (Mini System Monitor trop ancien ; à mettre à jour)',
  failed: 'session/tout -- (échec de Mini System Monitor)',
}

// A Mac with a current monitor; Claude Code replies in `language`, and the model
// answers a translation with `reply`
const world = (on: On, language: string, reply: string) => {
  const calls: string[] = []
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/Users/me' })
  on('settings.read', () => ({ value: { language } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'abc' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', () => ({ deny: 'no such file' }))
  on('process.run', (_$, e) => {
    const isGrep = e.argv[0] === '/usr/bin/grep'
    return { value: { exitCode: 0, stdout: isGrep ? '' : JSON_OUT, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('model.complete', (_$, e) => {
    calls.push(e.prompt)
    return { value: { isAnswered: true, text: reply, usage: USAGE } }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return { calls, clock }
}

const settle = async () => {
  for (let i = 0; i < 200; i++) await Promise.resolve()
}

describe('translated words', () => {
  test('another language is translated once and shown', async ($, on) => {
    const { calls } = world(on, 'french', `Voici :\n${JSON.stringify(FRENCH)}`)
    await $.session.start(START)
    await settle()
    const ui = await $.ui.mount({ plugin: 'cache-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
    await ui.redraw()

    expect(await ui.find({ type: 'Text', text: 'tout 60 min ' })).toBeDefined()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('"french"')

    // Settled again by a new session start: no second call
    await $.session.start(START)
    expect(calls).toHaveLength(1)
  })

  test('a translation that drops a placeholder is thrown away', async ($, on) => {
    const { calls } = world(on, 'french', JSON.stringify({ ...FRENCH, window: 'tout' }))
    await $.session.start(START)
    await settle()
    const ui = await $.ui.mount({ plugin: 'cache-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
    await ui.redraw()

    expect(calls).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: 'all 60m ' })).toBeDefined()
  })

  test('a reply that is not JSON fixes English, and is never asked again', async ($, on) => {
    const { calls, clock } = world(on, 'french', 'Désolé, je ne peux pas.')
    await $.session.start(START)
    await settle()
    const ui = await $.ui.mount({ plugin: 'cache-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
    await ui.redraw()

    expect(await ui.find({ type: 'Text', text: 'all 60m ' })).toBeDefined()
    await clock.advance(60_000)
    await $.session.start(START)
    expect(calls).toHaveLength(1)
  })

  for (const language of ['japanese', 'English']) {
    test(`${language} is written, never translated`, async ($, on) => {
      const { calls } = world(on, language, JSON.stringify(FRENCH))
      await $.session.start(START)
      await settle()
      await $.ui.mount({ plugin: 'cache-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

      expect(calls).toHaveLength(0)
    })
  }
})
