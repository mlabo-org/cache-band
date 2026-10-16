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

const JSON_OUT =
  '{"session":{"cache_read":96,"cache_write":2,"found":true,"input":100,"output":1,"partial":false},' +
  '"window":{"cache_read":97,"cache_write":1,"input":100,"output":1,"partial":false},"window_minutes":60}'

// A Mac where the monitor is absent, present but from before the flag, or current;
// `ran` records every command the mod started
const world = (on: On, monitor: 'absent' | 'old' | 'current', ran: string[][]) => {
  mock.clock(on)
  mock.store(on)
  on('settings.read', () => ({ value: {} }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'abc' }))
  on('fs.exists', () => ({ value: monitor !== 'absent' }))
  on('process.run', (_$, e) => {
    ran.push([...e.argv])
    const isGrep = e.argv[0] === '/usr/bin/grep'
    const exitCode = isGrep && monitor === 'old' ? 1 : 0
    return { value: { exitCode, stdout: isGrep ? '' : JSON_OUT, stderr: '' } }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}

// session.start leaves the first refresh running; let it settle
const settle = async () => {
  for (let i = 0; i < 200; i++) await Promise.resolve()
}

describe('the band and Mini System Monitor', () => {
  test('without the monitor the band shows nothing and runs nothing', { options: { language: 'en' } }, async ($, on) => {
    const ran: string[][] = []
    world(on, 'absent', ran)
    await $.session.start(START)
    await settle()
    const ui = await $.ui.mount({ plugin: 'cache-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

    expect(await ui.find({ type: 'Text', text: /cache|Mini System Monitor/ })).toBeUndefined()
    expect(ran).toEqual([])
  })

  test('an old monitor is named and never run', { options: { language: 'en' } }, async ($, on) => {
    const ran: string[][] = []
    world(on, 'old', ran)
    await $.session.start(START)
    await settle()
    const ui = await $.ui.mount({ plugin: 'cache-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

    expect(await ui.find({ type: 'Text', text: /too old/ })).toBeDefined()
    expect(ran.every(argv => argv[0] === '/usr/bin/grep')).toBe(true)
  })

  test('a current monitor gives the session and Mac-wide rates', { options: { language: 'en' } }, async ($, on) => {
    const ran: string[][] = []
    world(on, 'current', ran)
    await $.session.start(START)
    await settle()
    const ui = await $.ui.mount({ plugin: 'cache-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

    expect(await ui.find({ type: 'Text', text: '96%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '97%' })).toBeDefined()
    expect(ran.some(argv => argv.includes('--claude-cache-json') && argv.includes('abc'))).toBe(true)
  })
})
