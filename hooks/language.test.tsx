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

// A Mac with a current monitor, with Claude Code's settings, the process
// environment and, when given, the desktop app's display language
const world = (on: On, settings: Record<string, unknown>, env: Record<string, string>, app?: { locale: string; mtimeMs: number }) => {
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/Users/me', ...env })
  const APP_CONFIG = '/Users/me/Library/Application Support/Claude/config.json'
  on('fs.stat', (_$, e) => {
    if (app === undefined || e.path !== APP_CONFIG) return { deny: 'no such file' }
    return { value: { kind: 'file', size: 100, mtimeMs: app.mtimeMs, isLink: false } }
  })
  on('fs.read', (_$, e) => {
    if (app === undefined || e.path !== APP_CONFIG) return { deny: 'no such file' }
    return { value: JSON.stringify({ locale: app.locale, 'oauth:tokenCache': 'secret' }) }
  })
  on('settings.read', () => ({ value: settings }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'abc' }))
  on('fs.exists', () => ({ value: true }))
  on('process.run', (_$, e) => {
    const isGrep = e.argv[0] === '/usr/bin/grep'
    return { value: { exitCode: 0, stdout: isGrep ? '' : JSON_OUT, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return clock
}

const settle = async () => {
  for (let i = 0; i < 200; i++) await Promise.resolve()
}

const JAPANESE = [{ type: 'Text', text: 'セッション ' }, { type: 'Text', text: '全体60分 ' }] as const
const ENGLISH = [{ type: 'Text', text: 'session ' }, { type: 'Text', text: 'all 60m ' }] as const

type Case = {
  name: string
  options: Record<string, string>
  settings: Record<string, unknown>
  env: Record<string, string>
  shows: typeof JAPANESE | typeof ENGLISH
}

describe('language option', () => {
  const cases: Case[] = [
    { name: 'auto follows Claude Code replying in Japanese', options: {}, settings: { language: 'japanese' }, env: { LANG: 'en_US.UTF-8' }, shows: JAPANESE },
    { name: 'auto follows a Japanese locale when Claude Code has no language', options: {}, settings: {}, env: { LANG: 'ja_JP.UTF-8' }, shows: JAPANESE },
    { name: 'auto is English with nothing to go by', options: {}, settings: {}, env: {}, shows: ENGLISH },
    { name: 'auto follows Claude Code replying in English over a Japanese locale', options: {}, settings: { language: 'English' }, env: { LANG: 'ja_JP.UTF-8' }, shows: ENGLISH },
    { name: 'en fixes English', options: { language: 'en' }, settings: { language: 'japanese' }, env: { LANG: 'ja_JP.UTF-8' }, shows: ENGLISH },
    { name: 'ja fixes Japanese', options: { language: 'ja' }, settings: {}, env: { LANG: 'en_US.UTF-8' }, shows: JAPANESE },
  ]

  for (const c of cases) {
    test(c.name, { options: c.options }, async ($, on) => {
      world(on, c.settings, c.env)
      await $.session.start(START)
      await settle()
      const ui = await $.ui.mount({ plugin: 'cache-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

      for (const query of c.shows) expect(await ui.find(query)).toBeDefined()
    })
  }

  test('the desktop follows the app display language over Claude Code, the terminal does not', async ($, on) => {
    world(on, { language: 'japanese' }, {}, { locale: 'en-US', mtimeMs: 1 })
    await $.session.start(START)
    await settle()
    const desktop = await $.ui.mount({ plugin: 'cache-band', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    const terminal = await $.ui.mount({ plugin: 'cache-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

    for (const query of ENGLISH) expect(await desktop.find(query)).toBeDefined()
    for (const query of JAPANESE) expect(await terminal.find(query)).toBeDefined()
  })

  test('a switch of the app display language shows within seconds', async ($, on) => {
    const app = { locale: 'ja-JP', mtimeMs: 1 }
    const clock = world(on, {}, { LANG: 'en_US.UTF-8' }, app)
    await $.session.start(START)
    await settle()
    const desktop = await $.ui.mount({ plugin: 'cache-band', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    for (const query of JAPANESE) expect(await desktop.find(query)).toBeDefined()

    app.locale = 'en-US'
    app.mtimeMs = 2
    await clock.advance(3_000)
    for (const query of ENGLISH) expect(await desktop.find(query)).toBeDefined()
  })

  test('a switch of Claude Code language in /config shows at once', async ($, on) => {
    const settings: Record<string, unknown> = { language: 'japanese' }
    world(on, settings, {})
    on('config.set', (_$, e) => {
      settings.language = e.value
      return { value: e.value }
    })
    await $.session.start(START)
    await settle()
    const terminal = await $.ui.mount({ plugin: 'cache-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
    for (const query of JAPANESE) expect(await terminal.find(query)).toBeDefined()

    // The engine stamps the rest of the input as a /config change
    await $.config.set({ key: 'language', value: 'English' } as Parameters<typeof $.config.set>[0])
    for (const query of ENGLISH) expect(await terminal.find(query)).toBeDefined()
  })
})
