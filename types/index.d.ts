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

declare module 'claude-code' {
  interface PluginState {
    'cache-band': { reading: CacheReading | null; lastTurn: CacheTotals | null; failed: boolean }
  }
}
