import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { CacheProblem, CacheReading, CacheTotals, Words } from '../types'

const reading = atom({ plugin: 'cache-band', key: 'reading' } as const, null)
const lastTurn = atom({ plugin: 'cache-band', key: 'lastTurn' } as const, null)
const problem = atom({ plugin: 'cache-band', key: 'problem' } as const, null)

// Mini System Monitor owns the counting: the same code that fills its Claude view
// prints it as JSON, so the band and the monitor never disagree
export const DEFAULT_MONITOR = '/Applications/Mini System Monitor.app/Contents/MacOS/mini-system-monitor-rs'
const FLAG = '--claude-cache-json'

// The monitor reads every transcript touched in the last hour; a few hundred ms
const REFRESH_EVERY_MS = 30_000

// The language the band's words are in, as a key (`ja`, `en`, `fr`, `zh-tw`, or a
// language name): Claude Code's (every surface), and the desktop app's display
// language, which the desktop Code tab prefers
const language = atom({ plugin: 'cache-band', key: 'language' } as const, null)
const appLanguage = atom({ plugin: 'cache-band', key: 'appLanguage' } as const, null)
// Tables translated from EN, by language key
const translations = atom({ plugin: 'cache-band', key: 'translations' } as const, null)

// How often a change of either is picked up
const LANGUAGE_CHECK_MS = 3_000

// The band's own words as templates; `{name}` is filled in. Japanese and English
// are written here; any other language is translated from English once (see
// ensureWords). The `cache` label stays English.
const EN: Words = {
  lastTurn: 'last', session: 'session', window: 'all {minutes}m', read: 'read', write: 'write',
  outdated: 'session/all -- (Mini System Monitor too old; update it)',
  failed: 'session/all -- (Mini System Monitor failed)',
}

const JA: Words = {
  lastTurn: '直近', session: 'セッション', window: '全体{minutes}分', read: '読', write: '書',
  outdated: 'セッション・全体 -- (Mini System Monitor が古い。更新が必要)',
  failed: 'セッション・全体 -- (Mini System Monitor の実行に失敗)',
}

const WRITTEN: Record<string, Words> = { en: EN, ja: JA }

export const wordsFor = (key: string | null, translated: Record<string, Words> | null) =>
  (key === null ? undefined : (WRITTEN[key] ?? translated?.[key])) ?? EN

type MonitorTotals = { input: number; cache_read: number; cache_write: number; partial: boolean }

const totalsOf = (raw: MonitorTotals | null | undefined): CacheTotals | null =>
  raw == null ? null : { input: raw.input, cacheRead: raw.cache_read, cacheWrite: raw.cache_write, partial: raw.partial }

export const parseMonitor = (stdout: string): CacheReading => {
  const json = JSON.parse(stdout) as {
    window_minutes: number
    window: MonitorTotals | null
    session?: (MonitorTotals & { found: boolean }) | null
  }
  return {
    window: totalsOf(json.window),
    session: json.session?.found ? totalsOf(json.session) : null,
    windowMinutes: json.window_minutes,
  }
}

// A turn's usage in the monitor's terms: input is uncached + cache reads + writes
export const turnTotals = (usage: TurnUsage): CacheTotals => ({
  input: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
  cacheRead: usage.cache_read_input_tokens,
  cacheWrite: usage.cache_creation_input_tokens,
  partial: false,
})

export const rate = (totals: CacheTotals) =>
  totals.input === 0 ? null : Math.floor((totals.cacheRead / totals.input) * 100)

export const rateColor = (percent: number) => (percent >= 90 ? 'green' : percent >= 70 ? 'yellow' : 'red')

export const short = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`

export const monitorPathOf = (option: unknown) =>
  typeof option === 'string' && option.trim() !== '' ? option.trim() : DEFAULT_MONITOR

// The monitor path whose executable is known to have the flag. A monitor from
// before the flag ignores its arguments and opens its window, so it is never run
// until its file is seen to contain the flag's name.
let supported: string | null = null

async function check($: EngineInterface, monitor: string): Promise<CacheProblem | null> {
  if (supported === monitor) return null
  if (!(await $.fs.exists(monitor))) return 'missing'
  const { exitCode } = await $.process.run(['/usr/bin/grep', '-q', '-a', '-F', '--', FLAG, monitor], { timeoutMs: 10_000 })
  if (exitCode !== 0) return 'outdated'
  supported = monitor
  return null
}

async function refresh($: EngineInterface, option: unknown) {
  const monitor = monitorPathOf(option)
  try {
    const found = await check($, monitor)
    if (found !== null) {
      await update($, problem, () => found)
      return
    }
    const id = await $.session.id()
    const { exitCode, stdout } = await $.process.run([monitor, FLAG, '--session', id], { timeoutMs: 10_000 })
    if (exitCode !== 0) throw new Error(`exit ${exitCode}`)
    const next = parseMonitor(stdout)
    await update($, reading, () => next)
    await update($, problem, () => null)
  } catch {
    // Check again next time: the monitor may have been removed or replaced
    supported = null
    await update($, problem, () => 'failed')
  }
}

// A language as a key: `ja` and `en` for the written tables, else a lowercased
// locale tag (`fr`, `pt-br`, `zh-tw`, `sr-latin`) or language name (`french`);
// null when it names no language (`C`, `POSIX`, a bare `UTF-8`)
export const languageKey = (raw: string): string | null => {
  const lowered = raw.trim().toLowerCase()
  // A locale's modifier names its script (sr_RS@latin); its encoding names nothing
  const modifier = /@([a-z]+)/.exec(lowered)?.[1]
  const text = lowered.replace(/[.@].*$/, '').replace(/_/g, '-')
  if (text === '' || text === 'c' || text === 'posix' || /^utf-?8$/.test(text)) return null
  if (/^(japanese|日本語)/.test(text) || /^ja(?:$|-)/.test(text)) return 'ja'
  if (/^english/.test(text) || /^en(?:$|-)/.test(text)) return 'en'
  const tag = /^([a-z]{2,3})(?:-([a-z0-9]+))?$/.exec(text)
  if (tag === null) return text
  const [, base = text, region] = tag
  // Keep what changes the written language: zh-tw/zh-hant, pt-br, a script modifier
  if (modifier !== undefined) return `${base}-${modifier}`
  return region !== undefined && (base === 'zh' || base === 'pt') ? `${base}-${region}` : base
}

// `auto` follows Claude Code's own `language` setting (the language Claude replies
// in), then the locale variables; English with nothing to go by
async function claudeLanguage($: EngineInterface): Promise<string> {
  const { language: replyLanguage } = (await $.settings.read()) as { language?: unknown }
  const fromSetting = typeof replyLanguage === 'string' ? languageKey(replyLanguage) : null
  if (fromSetting !== null) return fromSetting
  const locale = (await $.env.get('LC_ALL')) || (await $.env.get('LC_MESSAGES')) || (await $.env.get('LANG')) || ''
  return languageKey(locale) ?? 'en'
}

// The desktop app keeps its display language as `locale` in its own config.json,
// an internal file that also holds its sign-in cache: read again only when its
// mtime moves, and nothing but `locale` kept. Null where there is no such app.
let appConfigMtime = -1

async function readAppLanguage($: EngineInterface): Promise<string | null | undefined> {
  const home = await $.env.get('HOME')
  if (home === undefined) return null
  const path = `${home}/Library/Application Support/Claude/config.json`
  try {
    const { mtimeMs } = await $.fs.stat(path)
    if (mtimeMs === appConfigMtime) return undefined
    appConfigMtime = mtimeMs
    const { locale } = JSON.parse(String(await $.fs.read(path))) as { locale?: unknown }
    return typeof locale === 'string' ? languageKey(locale) : null
  } catch {
    return null
  }
}

// A translated table is kept in the store per language, stamped with the English
// it came from, so a change of EN translates again
const hashText = (text: string) => {
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0
  return hash.toString(36)
}
const EN_VERSION = hashText(JSON.stringify(EN))
const TRANSLATE_CLAIM_MS = 60_000
const translating = new Set<string>()

const placeholders = (template: string) => (template.match(/\{\w+\}/g) ?? []).sort().join()

// A translation is taken whole or not at all: every key, every placeholder, one
// line each, and no longer than the band can hold
export const checkWords = (value: unknown): Words | null => {
  if (typeof value !== 'object' || value === null) return null
  const table = value as Record<string, unknown>
  for (const key of Object.keys(EN) as (keyof Words)[]) {
    const text = table[key]
    if (typeof text !== 'string' || text.trim() === '' || /[\n\[\]]/.test(text)) return null
    if (placeholders(text) !== placeholders(EN[key])) return null
    if (text.length > Math.max(24, EN[key].length * 2.5)) return null
  }
  return Object.fromEntries((Object.keys(EN) as (keyof Words)[]).map(key => [key, String(table[key])])) as Words
}

// A language's table as kept: its words, or `failed` when its translation did not
// hold, which keeps that language in English
type StoredWords = { version: string; words?: Words; failed?: true }

// Makes the table for `key` ready: written, already translated, kept in the
// store, or translated now by one small model call (the band shows English
// until it lands). A failure fixes English for that language, in every session,
// until the English words change; nothing is tried again before then.
async function ensureWords($: EngineInterface, key: string | null) {
  if (key === null || key in WRITTEN || translating.has(key)) return
  translating.add(key)
  let claimKey: string | undefined
  let isDone = false
  const storeKey = `words:${key}`
  try {
    if ((await read($, translations))?.[key] !== undefined) return
    const stored = (await $.store.get(storeKey)) as Partial<StoredWords> | undefined
    if (stored?.version === EN_VERSION && stored.failed === true) return
    const kept = stored?.version === EN_VERSION ? checkWords(stored.words) : null
    if (kept !== null) {
      await update($, translations, current => ({ ...current, [key]: kept }))
      return
    }
    const now = await $.clock.now()
    const claim = `translating:${key}`
    if (Number((await $.store.get(claim)) ?? 0) > now) return
    await $.store.set(claim, now + TRANSLATE_CLAIM_MS)
    claimKey = claim
    const result = await $.model.complete({
      model: 'haiku',
      system: 'You translate the user interface strings of a one-line status bar in a developer tool.',
      prompt:
        `Translate the values of this JSON object into the language "${key}" (a language name or a locale tag). ` +
        'Keep every key. Keep each {placeholder} exactly as written. Keep "--" and the name Mini System Monitor ' +
        'as they are. Make each value as short as a status bar needs. ' +
        'Answer with the JSON object only.\n\n' +
        JSON.stringify(EN),
      maxTokens: 1024,
      timeoutMs: 30_000,
    })
    if (!result.isAnswered) return
    const json = /\{[\s\S]*\}/.exec(result.text)?.[0]
    const words = json === undefined ? null : checkWords(JSON.parse(json))
    if (words === null) return
    await $.store.set(storeKey, { version: EN_VERSION, words })
    await update($, translations, current => ({ ...current, [key]: words }))
    isDone = true
  } catch {
    // English stays
  } finally {
    translating.delete(key)
    if (claimKey !== undefined) {
      await $.store.delete(claimKey).catch(() => undefined)
      if (!isDone) await $.store.set(storeKey, { version: EN_VERSION, failed: true }).catch(() => undefined)
    }
  }
}

// Settles both languages and makes their tables ready; `ja` or `en` in the
// option fixes them on every surface
async function refreshLanguage($: EngineInterface, option: unknown) {
  if (option === 'ja' || option === 'en') {
    await update($, language, () => option)
    await update($, appLanguage, () => null)
    return
  }
  const claude = await claudeLanguage($)
  await update($, language, current => (current === claude ? current : claude))
  const app = await readAppLanguage($)
  if (app !== undefined) await update($, appLanguage, current => (current === app ? current : app))
  void ensureWords($, claude)
  void ensureWords($, await read($, appLanguage))
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await refreshLanguage($, options.language)
    $.clock.every(LANGUAGE_CHECK_MS, () => void refreshLanguage($, options.language).catch(() => undefined))
    void refresh($, options.monitorPath).catch(() => undefined)
    // A reload drops the old timer with the old module
    $.clock.every(REFRESH_EVERY_MS, () => void refresh($, options.monitorPath).catch(() => undefined))

    return next(e)
  })

  // A `/config` change of Claude Code's language shows at once
  on('config.set', async ($, e, next) => {
    const result = await next(e)
    await refreshLanguage($, options.language).catch(() => undefined)

    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // Subagent turns count in the session and window figures, not as "last"
    if (e.agentId === undefined && e.usage !== undefined) {
      const totals = turnTotals(e.usage)
      await update($, lastTurn, () => totals)
    }
    void refresh($, options.monitorPath).catch(() => undefined)

    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const app = e.surface === 'desktop' ? await read($, appLanguage) : null
    const t = wordsFor(app ?? (await read($, language)), await read($, translations))
    const current = await read($, reading)
    const turn = await read($, lastTurn)
    // The band is one site shared by every plugin: keep what the ones beneath draw
    const below = await next(e)

    const part = (label: string, totals: CacheTotals | null, withCounts: boolean) => {
      const percent = totals === null ? null : rate(totals)
      if (totals === null || percent === null) return null
      return (
        <Box key={label}>
          <Text dimColor>{label} </Text>
          <Text color={rateColor(percent)}>{percent}%</Text>
          {totals.partial ? <Text dimColor>*</Text> : null}
          {withCounts ? (
            <Text dimColor>
              {' '}
              ({t.read} {short(totals.cacheRead)} / {t.write} {short(totals.cacheWrite)})
            </Text>
          ) : null}
          <Text> </Text>
        </Box>
      )
    }

    // The last turn needs no monitor, so it shows whatever the monitor's state.
    // No monitor at all is a choice, not a fault: its figures are left out without
    // a word. A monitor that is there but too old or failing is named, since its
    // owner expects the figures.
    const trouble = await read($, problem)
    const last = part(t.lastTurn, turn, false)
    const rest =
      trouble === 'missing' ? null : trouble !== null ? (
        <Text color="yellow">{t[trouble]}</Text>
      ) : (
        <Box>
          {part(t.session, current?.session ?? null, true)}
          {current?.window == null ? null : <Text dimColor>│ </Text>}
          {part(t.window.replace('{minutes}', String(current?.windowMinutes ?? 60)), current?.window ?? null, true)}
        </Box>
      )
    const row =
      last === null && (rest === null || (trouble === null && current === null)) ? null : (
        <Box>
          <Text dimColor>cache </Text>
          {last}
          {rest}
        </Box>
      )

    return (
      <Box flexDirection="column">
        {row ?? null}
        {below ?? null}
      </Box>
    )
  })
}
