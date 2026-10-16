# cache-band

A Claude Code mod: one line above the prompt with the prompt-cache read rate.

```
cache last 99% session 96% (read 7.6M / write 307k) │ all 60m 96% (read 11.3M / write 404k)
```

- **last**: the last main-thread turn (subagent turns are left out).
- **session**: this session's transcript and its subagents, from the start.
- **all 60m**: every Claude Code transcript on this Mac over the last hour.

The rate is cache reads ÷ all input (uncached + cache reads + cache writes);
"write" is cache creation. Green from 90%, yellow from 70%, red below; `*`
marks a total with unreadable records. It refreshes at the end of each turn
and every 30 seconds, and keeps the bands of other mods beneath it.

## Requires

[Mini System Monitor](https://github.com/mlabo-org/mini-system-monitor-rs)
installed at `/Applications/Mini System Monitor.app`, with
`--claude-cache-json`. The mod does not read transcripts itself: a mod's file
reads stop at 4 MiB and long transcripts are larger, and letting the monitor
count keeps the band and the monitor in agreement. Without it the band shows
`cache --`.

## Options

`language`: `auto` (Claude Code's language setting), `ja` or `en`.

## License

MIT
