# cache-band

[日本語](README.ja.md)

A Claude Code mod that draws one line above the prompt with the prompt-cache
read rate: of the last turn, of this session, and of every Claude Code session
on this Mac over the last hour.

```
cache last 99% session 84% (read 244k / write 46k) │ all 60m 97% (read 19.1M / write 548k)
```

Built for one person's Mac and published as a reference. It works anywhere the
requirements below are met, and every requirement is checked by a command.

## Which setup is yours

cache-band is the companion of [Mini System Monitor](https://github.com/mlabo-org/mini-system-monitor-rs)
(a macOS app with its own window). The monitor works without the band; the
band needs the monitor for two of its three figures.

| Your situation | What to do | What you get |
| --- | --- | --- |
| You already use Mini System Monitor | [Install](#install) steps 2, 3, 4. If step 2 opens the monitor's window instead of printing JSON, your build is older than the flag: update it first (step 1, with `--replace`) | All three figures. The monitor's window and settings are not changed |
| You do not use it yet | [Install](#install) steps 1 to 4 | All three figures. You also get the monitor's window (CPU, memory, Codex and Claude quota), but it does not have to be open for the band |
| You do not want the monitor | Only step 3 | `last` only, with nothing said about the monitor |

The monitor's README has the same split from its side:
[Use it alone or with cache-band](https://github.com/mlabo-org/mini-system-monitor-rs#use-it-alone-or-with-cache-band).

## Requirements

| Needed for | What | Check |
| --- | --- | --- |
| everything | macOS (Mini System Monitor needs macOS 14 or later) | `sw_vers -productVersion` |
| everything | Claude Code with mods (the plugin hooks API). Tested on 2.1.299, in the terminal and the desktop app's Code tab | `claude --version` |
| `session` and `all 60m` | [Mini System Monitor](https://github.com/mlabo-org/mini-system-monitor-rs) at commit `1f92771` (2026-10-17) or later, installed at `/Applications/Mini System Monitor.app` | see [Install](#install), step 2 |
| building the monitor | The Rust toolchain pinned by the monitor's `rust-toolchain.toml`, and Xcode Command Line Tools | `cargo --version`, `xcode-select -p` |

`last` needs nothing but Claude Code. With no monitor installed, the band shows
`last` alone and says nothing about the monitor: leaving it out is a choice, not
a fault. A monitor that is installed but too old or failing is named in the band
(see [Troubleshooting](#troubleshooting)), since its owner expects the figures.

The monitor has no prebuilt download; it is built from source. Why the mod
needs it: a mod's file reads stop at 4 MiB, and a long session's transcript is
larger (30 MiB and more), so the mod cannot count transcripts itself. The
monitor already counts them for its own window and prints the same totals as
JSON, so the band and the monitor always agree.

## Install

Run these in order. Each step says what success looks like.

### 1. Build and install Mini System Monitor

Skip to step 2 if it is already installed.

```bash
git clone https://github.com/mlabo-org/mini-system-monitor-rs.git
```

```bash
cd mini-system-monitor-rs && cargo fetch --locked
```

```bash
Scripts/install-app.sh --destination "/Applications/Mini System Monitor.app"
```

Success: the last line is `Installed and verified: /Applications/Mini System Monitor.app`.
The installer refuses to overwrite an existing app; to update one, quit it and
add `--replace` (the old app is kept beside it as `Mini System Monitor.previous-*.app`).

### 2. Check that the monitor has `--claude-cache-json`

```bash
"/Applications/Mini System Monitor.app/Contents/MacOS/mini-system-monitor-rs" --claude-cache-json
```

Success: one line of JSON that starts with `{"window":` and exit code 0, and no
window opens. If the monitor's window opens instead, that build is older than
the flag: quit it and update it as in step 1 with `--replace`.

### 3. Install the mod

In a Claude Code session:

```text
/plugin install cache-band --marketplace mlabo-org/cache-band
```

Or from your shell:

```bash
claude plugin marketplace add mlabo-org/cache-band
```

```bash
claude plugin install cache-band@cache-band
```

### 4. Start a new session

The band appears with the first reply of a new session, not on the empty
new-session screen: mods run once the session has started.

## What it shows

- **last**: the last turn of the main conversation (subagent turns are left
  out), from the usage Claude Code reports when the turn ends.
- **session**: this session's transcript and its subagent transcripts, from the
  start of the session.
- **all 60m**: every Claude Code transcript on this Mac (terminal and the
  desktop Code tab) over the last 60 minutes.

The rate is cache reads ÷ all input, where all input is uncached input + cache
reads + cache writes; `write` is cache creation. Green from 90%, yellow from
70%, red below. `*` after a rate means some records could not be read, so the
total may be low.

It refreshes when each turn ends and every 30 seconds. The bands of other mods
stay beneath it.

Reading the numbers: a new session's first turn is often around 50%, because
its own context is written to the cache once. The rate then climbs turn by
turn. A sudden drop of `last` in the middle of a conversation means the cache
was not reused, for example after a pause of more than 5 minutes, a model
switch, or a compaction.

## Options

Set them in the `/config` panel, or with
`claude plugin install cache-band@cache-band --config KEY=VALUE`.

| Key | Default | Meaning |
| --- | --- | --- |
| `language` | `auto` | `auto` follows Claude Code's `language` setting (Japanese when it names Japanese, English otherwise); `ja` or `en` fixes it. |
| `monitorPath` | `/Applications/Mini System Monitor.app/Contents/MacOS/mini-system-monitor-rs` | The monitor's executable, inside its app bundle. Change it only when the app is installed elsewhere. |

## Troubleshooting

| The band shows | Cause | Fix |
| --- | --- | --- |
| no `cache` line at all | The session has not started yet, or the mod is not installed | Send a message; then check `claude plugin list` for `cache-band` |
| `session/all -- (Mini System Monitor too old; update it)` | The executable does not contain `--claude-cache-json` | Quit the monitor and reinstall it from the latest source with `--replace` |
| `session/all -- (Mini System Monitor failed)` | The monitor ran but exited with an error or printed something that is not its JSON | Run the command in step 2 yourself and read its error |
| `last` only, never `session` or `all 60m` | No monitor at `monitorPath` (shown this way on purpose) | Install the monitor (step 1), or set `monitorPath` to where it is |

The mod never runs a monitor that lacks the flag: before the first run it
checks that the executable contains the text `--claude-cache-json`, because an
older monitor ignores its arguments and opens its window.

## What it reads and runs

- Runs `/usr/bin/grep` once per session on the monitor's executable (the check
  above), then the monitor with `--claude-cache-json --session <session id>`.
- The monitor reads `projects/**/*.jsonl` under `CLAUDE_CONFIG_DIR` (default
  `~/.claude`) and prints token counts only. Nothing is written, sent or kept
  beyond the current session's band.

## Check

```bash
claude plugin validate /path/to/cache-band
```

```bash
claude plugin test /path/to/cache-band
```

## License

[MIT](LICENSE)
