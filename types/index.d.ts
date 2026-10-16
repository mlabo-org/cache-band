// One count of input tokens, as Mini System Monitor reports it: `input` is all
// input (uncached + cache reads + cache writes), `cacheRead` and `cacheWrite`
// are parts of it
export type CacheTotals = {
  input: number
  cacheRead: number
  cacheWrite: number
  partial: boolean
}

export type CacheReading = {
  session: CacheTotals | null
  window: CacheTotals | null
  windowMinutes: number
}

// Why the session and Mac-wide figures are missing: no executable at the monitor
// path, a monitor from before --claude-cache-json, or a run that failed
export type CacheProblem = 'missing' | 'outdated' | 'failed'

declare module 'claude-code' {
  interface PluginState {
    'cache-band': { reading: CacheReading | null; lastTurn: CacheTotals | null; problem: CacheProblem | null }
  }
}
