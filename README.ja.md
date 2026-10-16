# cache-band

[English](README.md)

Claude Code の mod。入力欄の上に、プロンプトキャッシュの読み込み率を1行で出します。直近の1ターン、このセッション、この Mac の Claude Code 全体（直近1時間）の3つです。

```
cache 直近 99% セッション 84% (読 244k / 書 46k) │ 全体60分 97% (読 19.1M / 書 548k)
```

作者の Mac のために作ったものを、参考として公開しています。下の条件がそろえばどこでも動きます。条件はすべてコマンドで確かめられます。

## どの使い方か

cache-band は [Mini System Monitor](https://github.com/mlabo-org/mini-system-monitor-rs)（自分の画面を持つ macOS アプリ）の相棒です。モニターは帯がなくても動きますが、帯の3つの数字のうち2つはモニターがないと出ません。

| あなたの状況 | やること | 得られるもの |
| --- | --- | --- |
| すでに Mini System Monitor を使っている | [導入](#導入)の手順2・3・4。手順2で JSON が出ずにモニターの画面が開いたら、その版はこの機能より古いので、先に更新する（手順1を `--replace` 付きで） | 3つの数字すべて。モニターの画面や設定は変わりません |
| まだ使っていない | [導入](#導入)の手順1〜4 | 3つの数字すべて。モニターの画面（CPU、メモリ、Codex と Claude の残量）も手に入りますが、帯のために開いておく必要はありません |
| モニターは入れたくない | 手順3だけ | 「直近」だけ。その後ろにずっと `セッション・全体 -- (Mini System Monitor が見つからない)` が出ます。この使い方はそれ以上は想定していません |

モニター側の README にも、同じ分け方で書いてあります：[単体で使う・cache-band と併用する](https://github.com/mlabo-org/mini-system-monitor-rs/blob/main/README.ja.md#単体で使うcache-band-と併用する)

## 必要なもの

| 何のために | 必要なもの | 確かめ方 |
| --- | --- | --- |
| 全体 | macOS（Mini System Monitor は macOS 14 以降） | `sw_vers -productVersion` |
| 全体 | mod（プラグインのフック API）が使える Claude Code。2.1.299 のターミナルとデスクトップアプリの Code タブで確認済み | `claude --version` |
| セッションと全体60分 | `/Applications/Mini System Monitor.app` に入った [Mini System Monitor](https://github.com/mlabo-org/mini-system-monitor-rs)（コミット `1f92771`、2026-10-17 以降） | [導入](#導入)の手順2 |
| モニターのビルド | モニターの `rust-toolchain.toml` で固定された Rust ツールチェーンと Xcode Command Line Tools | `cargo --version`、`xcode-select -p` |

「直近」は Claude Code だけで出ます。モニターがなくても帯には「直近」が出て、その後ろに残り2つが出ない理由が表示されます（[困ったとき](#困ったとき)）。

モニターに配布用のビルド済みファイルはなく、ソースからビルドします。モニターが必要な理由：mod のファイル読み込みは 4 MiB までで、長いセッションの記録はそれを超えます（30 MiB 以上になることもある）。そのため mod は自分では記録を数えられません。モニターは自分の画面のために記録をすでに数えていて、同じ集計を JSON で出せるので、帯とモニターの数字は必ず一致します。

## 導入

順番に実行してください。各手順に、成功したときの見え方を書いてあります。

### 1. Mini System Monitor をビルドして入れる

すでに入っていれば手順2へ。

```bash
git clone https://github.com/mlabo-org/mini-system-monitor-rs.git
```

```bash
cd mini-system-monitor-rs && cargo fetch --locked
```

```bash
Scripts/install-app.sh --destination "/Applications/Mini System Monitor.app"
```

成功すると、最後の行が `Installed and verified: /Applications/Mini System Monitor.app` になります。インストーラーは既存のアプリを上書きしません。更新するときはモニターを終了してから `--replace` を付けます（古いアプリは `Mini System Monitor.previous-*.app` として横に残ります）。

### 2. モニターが `--claude-cache-json` に対応しているか確かめる

```bash
"/Applications/Mini System Monitor.app/Contents/MacOS/mini-system-monitor-rs" --claude-cache-json
```

成功すると、`{"window":` で始まる JSON が1行出て、終了コードは 0、ウィンドウは開きません。モニターのウィンドウが開いてしまったら、その版はこの機能より古いものです。終了してから、手順1のとおり `--replace` で更新してください。

### 3. mod を入れる

Claude Code のセッションで：

```text
/plugin install cache-band --marketplace mlabo-org/cache-band
```

またはシェルで：

```bash
claude plugin marketplace add mlabo-org/cache-band
```

```bash
claude plugin install cache-band@cache-band
```

### 4. 新しいセッションを始める

帯は、新しいセッションの最初の返事と一緒に出ます。何も送っていない新規セッションの画面には出ません。mod はセッションが始まってから動くためです。

## 表示の意味

- **直近**：本体の会話の最後の1ターン（サブエージェントのターンは含めない）。ターンの終わりに Claude Code が報告する使用量から計算します
- **セッション**：このセッションの記録とそのサブエージェントの記録の、セッション開始からの合計
- **全体60分**：この Mac の Claude Code の記録すべて（ターミナルとデスクトップの Code タブ）の直近60分

率は「キャッシュ読み込み ÷ 入力全体」で、入力全体はキャッシュなしの入力＋読み込み＋書き込みです。「書」はキャッシュ作成分です。90%以上は緑、70%以上は黄、それ未満は赤。率の後ろの `*` は、読めない記録があって実際より少なく数えている可能性を示します。

更新はターンの終わりごとと30秒ごとです。他の mod の帯はその下に残ります。

読み方：新しいセッションの最初のターンは 50% 前後になることがよくあります。そのセッション自身の文脈を一度キャッシュに書き込むためです。その後はターンごとに上がっていきます。会話の途中で「直近」が急に下がったら、キャッシュが使われなかった合図です。たとえば5分以上あいた、モデルを切り替えた、圧縮（compact）した、などです。

## 設定

`/config` の画面で設定するか、`claude plugin install cache-band@cache-band --config キー=値` で渡します。

| キー | 既定値 | 意味 |
| --- | --- | --- |
| `language` | `auto` | `auto` は Claude Code の `language` 設定に従います（日本語を指していれば日本語、それ以外は英語）。`ja` か `en` で固定。 |
| `monitorPath` | `/Applications/Mini System Monitor.app/Contents/MacOS/mini-system-monitor-rs` | アプリの中にあるモニターの実行ファイル。アプリを別の場所に入れたときだけ変えます。 |

## 困ったとき

| 帯の表示 | 原因 | 直し方 |
| --- | --- | --- |
| `cache` の行がない | セッションがまだ始まっていない、または mod が入っていない | 何か送ってみる。それでも出なければ `claude plugin list` に `cache-band` があるか見る |
| `セッション・全体 -- (Mini System Monitor が見つからない)` | `monitorPath` にファイルがない | モニターを入れる（手順1）か、`monitorPath` を実際の場所に変える |
| `セッション・全体 -- (Mini System Monitor が古い。更新が必要)` | 実行ファイルに `--claude-cache-json` が含まれていない | モニターを終了し、最新のソースから `--replace` で入れ直す |
| `セッション・全体 -- (Mini System Monitor の実行に失敗)` | モニターが動いたが、エラーで終わったか JSON 以外を出した | 手順2のコマンドを自分で実行してエラーを読む |
| 「直近」だけで後ろに何もない | 最初の更新がまだ終わっていない | 次のターンか30秒待つ |

mod は、この機能に対応していないモニターを実行しません。古いモニターは引数を無視してウィンドウを開いてしまうため、最初に実行する前に、実行ファイルに `--claude-cache-json` という文字列が含まれているかを確かめています。

## 読むもの・実行するもの

- セッションごとに1回、モニターの実行ファイルに対して `/usr/bin/grep` を実行します（上の確認）。そのあとモニターを `--claude-cache-json --session <セッションID>` で実行します
- モニターは `CLAUDE_CONFIG_DIR`（未指定なら `~/.claude`）の下の `projects/**/*.jsonl` を読み、トークン数だけを出します。何も書き込まず、送信もせず、そのセッションの帯の表示以外には残しません

## 動作確認

```bash
claude plugin validate /path/to/cache-band
```

```bash
claude plugin test /path/to/cache-band
```

## ライセンス

[MIT](LICENSE)
