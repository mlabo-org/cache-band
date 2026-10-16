import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { CacheProblem, CacheReading, CacheTotals } from '../types'

const reading = atom({ plugin: 'cache-band', key: 'reading' } as const, null)
const lastTurn = atom({ plugin: 'cache-band', key: 'lastTurn' } as const, null)
const problem = atom({ plugin: 'cache-band', key: 'problem' } as const, null)

// Mini System Monitor owns the counting: the same code that fills its Claude view
// prints it as JSON, so the band and the monitor never disagree
export const DEFAULT_MONITOR = '/Applications/Mini System Monitor.app/Contents/MacOS/mini-system-monitor-rs'
const FLAG = '--claude-cache-json'

// The monitor reads every transcript touched in the last hour; a few hundred ms
const REFRESH_EVERY_MS = 30_000

const WORDS: Record<'ja' | 'en', Record<'lastTurn' | 'session' | 'window' | 'read' | 'write' | CacheProblem, string>> = {
  ja: {
    lastTurn: '直近', session: 'セッション', window: '全体{minutes}分', read: '読', write: '書',
    missing: 'セッション・全体 -- (Mini System Monitor が見つからない)',
    outdated: 'セッション・全体 -- (Mini System Monitor が古い。更新が必要)',
    failed: 'セッション・全体 -- (Mini System Monitor の実行に失敗)',
  },
  en: {
    lastTurn: 'last', session: 'session', window: 'all {minutes}m', read: 'read', write: 'write',
    missing: 'session/all -- (Mini System Monitor not found)',
    outdated: 'session/all -- (Mini System Monitor too old; update it)',
    failed: 'session/all -- (Mini System Monitor failed)',
  },
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
    await update($, problem, () => 'failed')
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
    void refresh($, options.monitorPath)
    // A reload drops the old timer with the old module
    $.clock.every(REFRESH_EVERY_MS, () => void refresh($, options.monitorPath))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // Subagent turns count in the session and window figures, not as "last"
    if (e.agentId === undefined && e.usage !== undefined) {
      const totals = turnTotals(e.usage)
      await update($, lastTurn, () => totals)
    }
    void refresh($, options.monitorPath)

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

    // The last turn needs no monitor, so it shows even when the monitor is the problem
    const trouble = await read($, problem)
    const row = (
      <Box>
        <Text dimColor>cache </Text>
        {part(t.lastTurn, turn, false)}
        {trouble !== null ? (
          <Text color="yellow">{t[trouble]}</Text>
        ) : (
          <Box>
            {part(t.session, current?.session ?? null, true)}
            {current?.window == null ? null : <Text dimColor>│ </Text>}
            {part(t.window.replace('{minutes}', String(current?.windowMinutes ?? 60)), current?.window ?? null, true)}
          </Box>
        )}
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
