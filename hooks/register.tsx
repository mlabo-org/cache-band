import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { CacheReading, CacheTotals } from '../types'

const reading = atom({ plugin: 'cache-band', key: 'reading' } as const, null)
const lastTurn = atom({ plugin: 'cache-band', key: 'lastTurn' } as const, null)
const failed = atom({ plugin: 'cache-band', key: 'failed' } as const, false)

// Mini System Monitor owns the counting: the same code that fills its Claude view
// prints it as JSON, so the band and the monitor never disagree
const MONITOR = '/Applications/Mini System Monitor.app/Contents/MacOS/mini-system-monitor-rs'

// The monitor reads every transcript touched in the last hour; a few hundred ms
const REFRESH_EVERY_MS = 30_000

const WORDS = {
  ja: { lastTurn: '直近', session: 'セッション', window: '全体{minutes}分', read: '読', write: '書', missing: 'cache -- (システムモニターから取れない)' },
  en: { lastTurn: 'last', session: 'session', window: 'all {minutes}m', read: 'read', write: 'write', missing: 'cache -- (Mini System Monitor unavailable)' },
}

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

async function refresh($: EngineInterface) {
  try {
    const id = await $.session.id()
    const { exitCode, stdout } = await $.process.run([MONITOR, '--claude-cache-json', '--session', id], { timeoutMs: 10_000 })
    if (exitCode !== 0) throw new Error(`exit ${exitCode}`)
    const next = parseMonitor(stdout)
    await update($, reading, () => next)
    await update($, failed, () => false)
  } catch {
    await update($, failed, () => true)
  }
}

async function wordsFor($: EngineInterface, option: unknown) {
  if (option === 'ja' || option === 'en') return WORDS[option]
  const { language } = (await $.settings.read()) as { language?: unknown }
  const isJapanese = typeof language === 'string' && /^(ja|japanese|日本)/i.test(language.trim())
  return isJapanese ? WORDS.ja : WORDS.en
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    void refresh($)
    // A reload drops the old timer with the old module
    $.clock.every(REFRESH_EVERY_MS, () => void refresh($))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // Subagent turns count in the session and window figures, not as "last"
    if (e.agentId === undefined && e.usage !== undefined) {
      const totals = turnTotals(e.usage)
      await update($, lastTurn, () => totals)
    }
    void refresh($)

    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const t = await wordsFor($, options.language)
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

    const row =
      current === null && (await read($, failed)) ? (
        <Text dimColor>{t.missing}</Text>
      ) : (
        <Box>
          <Text dimColor>cache </Text>
          {part(t.lastTurn, turn, false)}
          {part(t.session, current?.session ?? null, true)}
          {current?.window == null ? null : <Text dimColor>│ </Text>}
          {part(t.window.replace('{minutes}', String(current?.windowMinutes ?? 60)), current?.window ?? null, true)}
        </Box>
      )

    return (
      <Box flexDirection="column">
        {row}
        {below ?? null}
      </Box>
    )
  })
}
