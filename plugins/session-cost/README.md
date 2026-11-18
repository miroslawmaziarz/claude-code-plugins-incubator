# session-cost

A Claude Code mod that records every model request the session sends and shows its tokens and cost in a pane beside the chat. It collects data the whole time, whether the pane is open or closed.

## What it shows

- **Header**: the session's cost as `/cost` reports it, the price-table estimate, the request count, token totals (input, output, cache read, cache write, with `(1h …)` after the write total when the `cacheTtlSplit` setting is on), the cache hit rate, requests by kind (main, subagent, compaction) and the installed version (`v<version>`, dim, from this copy's `plugin.json`). The header is the same on every view.
- **Requests view** (`r`): one entry per request, newest first; the newest 300 are drawn and the totals count all. It shows the time, model, the effort the request asked for (dim, after the model, e.g. `opus-5-5 high`; absent for models without effort and for compactions), `main` / `sub:<agent>` / `compact`, duration written flush right on a 7-cell bar with a background track, filled in proportion to the slowest request drawn (the slowest one is highlighted), stop reason (a request that called tools shows them instead of `tool_use`, e.g. `→ Read ×3, Bash`; MCP tools by their short name), the four token counts (`cr` in green and `cw` in red, each in five steps from light to vivid by its share of the request's prompt tokens; a zero count is dim; with `cacheTtlSplit` on, a dim `1h`, `5m` or `1h 8k+5m 4k` after `cw` says which cache lifetime the write used), and two costs: the request's share of the `/cost` ledger and the estimate (`$0.020 / est $0.029`).
- **Models view** (`m`): requests, tokens, cache hit rate and both costs per model.
- **History view** (`h`): this session, today, the last 7 days and the last `historyDays` days; then **By day**, one row per day with spend in the last `historyDays` days, newest first (this session's cost and requests beside the cost of all sessions and how many had spend that day; a session open across several days says how many it spans); then the 10 most recent sessions. Each recent session shows its time, cost, requests, short id and name: its `/rename` title, else the title Claude Code generated for it, else its first prompt (on one line, cut to 60 characters, and cut further to fit the row). A session with none of these, or saved before 0.7.0, shows its id alone. The windows are calendar days and count only the part of each session spent in them. (The separate Days view of earlier versions is now this section.) Each recent session, and this session once it has a request, has a `·` mark: press one to mark it **A**, then another to mark it **B** and open the Compare view. Its `›` opens the session's details.
- **Stats view** (`s`, only with the `stats` setting on): a usage profile of this session, gathered from the moment the setting is on:
  - **Cost breakdown**: the estimate split into input, output, cache read, 5-minute writes, 1-hour writes and writes of unknown TTL, each with its share.
  - **Cache TTL**: 1-hour, 5-minute and unknown write tokens, the cache hit rate overall and per kind, and the 1-hour premium (1-hour writes × the difference between the 1-hour and 5-minute write prices).
  - **Idle gaps** on the main thread, start to start: under 5 minutes, 5–60 minutes, over 60 minutes; gaps a 1-hour write kept warm (with `saved ~`, the request's cache read priced as a 5-minute re-write minus the read), gaps after a 5-minute write, and misses seen (a gap past the TTL followed by a request that read under 10% of its prompt from the cache); `1h net` is saved minus premium. These are estimates: they assume the previous request's write is what the next one reads.
  - **Requests**: count by kind, average tokens per request, duration p50 / p90 / max (over the newest 2000), the top models by estimate and the top tools.
  Without `cacheTtlSplit`, every write counts as unknown and the TTL figures stay empty.
- **Session details** (`›` on a History row): the session's `/cost` total, estimate, requests, token counts, cache hit rate and summed request time; its hierarchy, `main` (what the main loop spent itself) with each subagent under the agent that spawned it (`└ Explore agent-ab`, then its own subagents indented below), each with its cost and request count, plus an `unattributed` line for `/cost` spend no request took, so the lines add up to the total History shows; then its requests, oldest first (time, model, `main` / subagent type, the four token counts, ledger share and estimate). A subagent whose spawner the record does not hold (one started before the mod loaded), or whose recorded parents loop, is listed directly under `main`, so every subagent appears once. Press a subagent to open its own details: its totals count it and every subagent under it, its own line (`Explore own`) and its subagents' lines add up to that total, and its requests are its own and its subagents'. `back` (`b`) goes up to its parent, then the session, then History. From the keyboard, ctrl+x tab (or a click) gives the pane the keys; Tab and the arrows then walk the `·`, `›` and subagent rows, and Enter presses the one under the focus. This session's details come from its live rows (the newest 1000). A saved session lists the newest 200 requests it kept and says how many it dropped; one saved before 0.7.0 shows neither rows nor hierarchy, with a dim note.
- **Compare view** (`c`): two sessions side by side, A the baseline, `—` until both are picked. Every metric row shows A, B, B−A and %: green when B is better (cheaper, faster, fewer tokens), red when worse; the cache hit rate is the other way round (higher is green, its change in percentage points). The metrics: `/cost` and the estimate, requests, the four token counts, the cache hit rate, wall-clock time (first request's start to last one's end) and summed request time; then requests, tokens and cost by kind (main, sub, compact), by model, and by subagent type (`sub:Explore`, `sub:Plan`, …). `swap` (`w`) flips A and B. A session saved before 0.7.0 compares on its totals; its wall-clock time, request time and breakdowns show `n/a` with a dim note. Compare whole sessions: for clean results, run each variant in a fresh session.
- In the Requests view, a dim `── Sat 07 Nov ──` row marks where the day changes.
- A status-line entry under the prompt: `$0.544 · 3 req · 130k tok`.
- A one-line chip above the prompt (`$0.544 · 3 req · 130k tok  usage`). Its button toggles the pane and carries the keyboard shortcut. While you collapse the band, the mod skips the cost text and keeps only the button, so the shortcut still works.

### How cost is counted

Claude Code reports dollars only as the running session total (the `/cost` ledger). When a request's response ends and no other request is still running, the mod reads that total. The increase since the last reading becomes that request's cost, so the ledger column always adds up to `/cost`. When requests overlap, as parallel subagents do, the increase is split between them by estimated cost and marked `~`. Spend from before the mod loaded, or spend the engine makes outside model requests (title generation, classifiers), shows in the header as `unattributed`.

The **estimate** prices the token counts with a built-in table of Anthropic first-party list prices (`hooks/pricing.ts`). It cannot see fast mode, partner pricing (Bedrock, Vertex), Haiku 5.5's higher rate for prompts over 100K tokens ($0.50 / $2.50 per million instead of $0.10 / $0.50), or prices that changed after the table was written. An unknown model shows `?`. Cache writes are priced at the 5-minute rate (1.25× input) unless `cacheTtlSplit` is on and the request's split was found; then 1-hour writes are priced at 2× input.

### What it fetches and runs

- **Network**: none. The mod fetches nothing and sends nothing; it makes no network calls of any kind.
- **Reads from the conversation**: its `turn.step` hook passes every model request through unchanged and, after the response, records only metadata: the token counts, model, effort, start and end time, stop reason, the names of the tools called, and whether a subagent made it. It does not read responses, tool inputs or tool results. Its `prompt.submit` hook passes every prompt through unchanged and keeps the first one you send (typed, from a phone or from the SDK; not a slash command or a peer's message) as the session's name, on one line and cut to 60 characters. This data stays in the session's plugin state and the plugin's local store.
- **Reads from disk**: its own `.claude-plugin/plugin.json` (under the plugin's install folder), to show the installed version in the pane's header, and the session's transcript, for the session's title only. At the end of each turn it reads what the transcript gained since the last read (at most its last 1 MiB) and keeps only the `custom-title` (`/rename`) and `ai-title` rows' text; every other row is skipped unparsed. With `cacheTtlSplit` on (off by default), also the session's transcript files under `~/.claude/projects/` (or `$CLAUDE_CONFIG_DIR/projects/`), after each request that wrote to the cache, to take the 1-hour and 5-minute cache-write counts from the usage numbers there. It keeps only those counts.
- **Reads about subagents**: its `agent.spawn` hook passes every subagent spawn through unchanged and keeps only the agent's id, its type (`Explore`, `Plan`, …) and the id of the agent that spawned it; for a subagent it did not see start, it looks the type up in the session's agent list. It does not read the subagent's prompt or description.
- **Runs**: nothing. The mod starts no processes, runs no shell commands, calls no tools, agents or models, and hooks no tool calls.
- **Its `command.run` hook** answers only its own `/session-cost` slash command. It reads the argument against a fixed list (`on`, `off`, `requests`, `models`, `history`, `stats`, `days` (opens History), `compare`, `reset`, `toggle`), opens, closes or switches the pane or clears the session's data, and returns a one-line reply. `compare A B` looks the two words up among the saved sessions and this one, and opens the Compare view on them; two words that name the same session get a reply saying so and open nothing. Any other argument gets an "Unknown argument" reply and does nothing.

### How days are counted

A request counts on the local calendar day its response ended, so one session can spread over several days. Ledger shares follow their request's day; `/cost` growth read while no request was waiting counts on the day it was read. Spend from before the mod loaded is in no day. A session that was already running when this version loaded has its days rebuilt from its kept rows, with anything past the 1000-row cap on the earliest day. Sessions saved by an older version count whole on the day of their last request.

## Privacy

The mod keeps its data on your computer and sends none of it anywhere; see [What it fetches and runs](#what-it-fetches-and-runs) and the full [privacy policy](PRIVACY.md).

## Command

```
/session-cost                 toggle the pane
/session-cost on|off          open or close it explicitly
/session-cost requests|models|history|stats|compare   open it on that view (stats needs the `stats` setting; `days` opens History)
/session-cost compare <A> <B> compare two sessions, each named by its id, an id prefix or its name
                              (a unique part of it is enough; "quote" a name with spaces)
/session-cost reset           clear this session's requests, totals, day split, name and saved history entry
```

The pane's own close mark, or ctrl+x x while the pane holds the keyboard, also closes it.

## Keyboard toggle

Mods can't register a global shortcut, and `keybindings.json` can't run a slash command. Instead, the chip's button is tied to an engine keybinding action that has no default key (`toggleAction`, default `app:toggleReplTab`). Bind a chord to that action in `~/.claude/keybindings.json`:

```json
{
  "$schema": "https://www.schemastore.org/claude-code-keybindings.json",
  "$docs": "https://code.claude.com/docs/en/keybindings",
  "bindings": [
    { "context": "Global", "bindings": { "ctrl+x c": "app:toggleReplTab" } }
  ]
}
```

The chord works while the chip is on (`band` on), even with the band collapsed, and no dialog is up. If that action already does something in your setup, pick another in `/config` and bind that one instead.

## Settings

These appear in `/config` under the plugin and are stored in `pluginConfigs["session-cost"].options`:

| Field | Default | Meaning |
|---|---|---|
| `autoOpen` | `false` | Open the pane by itself when a session starts. |
| `statusLine` | `true` | Show the `$… · n req · … tok` summary under the prompt. |
| `band` | `true` | Show the cost chip above the prompt. The keyboard toggle needs it. |
| `toggleAction` | `app:toggleReplTab` | The engine action the chip's button borrows for the keyboard toggle. |
| `historyDays` | `30` | How many days of per-session, per-day totals to keep. |
| `stats` | `false` | Gather the session's usage profile and show the Stats tab. Off, nothing is gathered and the tab is hidden; the profile covers requests from when it was turned on, and `/session-cost reset` clears it. |
| `cacheTtlSplit` | `false` | Tell 1-hour from 5-minute cache writes per request. Claude Code's hooks report only the write total, so this reads the split from the session's transcript. A transcript over 4 MiB cannot be read (the mod API's limit), so long sessions show the plain `cw` count again from that point. |

## Data

- The request list (the newest 1000), the running totals and the day split live in the session's plugin state, so they survive `/reload-plugins` and a change of settings. Totals keep counting past 1000 requests.
- Per-session totals, split by day, are kept across sessions in the plugin's store. Days older than `historyDays` are pruned, and a session is removed once it has none left.
- Each saved session also keeps its name (title or first prompt, up to 60 characters). Sessions saved before 0.7.0 have none.
- Each saved session also keeps a rollup for comparing it later: its first-request start and last-request end, summed request time, and requests, tokens, estimate and ledger cost by kind, by model and per subagent (keyed by the subagent's id, with its type and the agent that spawned it). The rollup itself holds no per-request rows: about 200 bytes per model and per subagent. It is pruned with the session's entry. A session whose kept rows no longer add up to its totals (one already running when 0.7.0 loaded, with requests past the 1000-row cap) saves no rollup and compares on totals, like sessions saved before 0.7.0.
- Each saved session also keeps its newest 200 requests for the details view, numbers only: sequence number, end time, duration, kind, subagent id, model, the four token counts, estimate and ledger share (no turn id, effort, stop reason or tool names; about 250 bytes each, so at most about 50 KB per session). They are pruned with the session's entry. Sessions saved before 0.7.0 have none.
- `/clear` saves the ending session's totals and name to history and starts the list over; the ending session's titles are read from its own transcript file, and the next conversation's file is read from its start, so the next conversation is named by its own title or first prompt.
- `/session-cost reset` deletes the session's saved entry and forgets the name it kept, so the deleted entry's name is not written back: the transcript's titles are read again at the end of the next turn, and without one the next prompt you send names the session. From then on its history counts only spend since the reset, while the header, chip and status line keep showing the full `/cost` total. The header lists the pre-reset part as `unattributed`.

## Install

At the prompt of a terminal session:

```
/plugin marketplace add kKEo/claude-code-plugins-incubator
/plugin install session-cost@km-plugin-registry
```

The mod does not check for updates itself. To update:

```
/plugin marketplace update km-plugin-registry
/plugin update session-cost@km-plugin-registry
```

For development, start a session with the folder loaded and hot-reloaded:

```
claude --plugin-dir plugins/session-cost
```

## Files

- `hooks/register.tsx`: the hooks module (request collection, ledger reads, history, command, chip and pane).
- `hooks/ledger.ts`: totals, the row cap and the ledger-delta split.
- `hooks/stats.ts`: the Stats tab's usage profile (cost parts, TTL, idle gaps, percentiles).
- `hooks/days.ts`: day keys, the per-day buckets, backfill and history windows.
- `hooks/pricing.ts`: the price table and the estimate.
- `hooks/ttl.ts`: the transcript path and the 1-hour / 5-minute split read from it.
- `hooks/version.ts`: reads the `version` out of a `plugin.json`.
- `hooks/names.ts`: reads titles out of transcript rows and picks a session's name.
- `hooks/rollup.ts`: the per-session rollup (by kind, model and subagent) kept for comparing.
- `hooks/compare.ts`: the Compare view's metrics and deltas, and finding a session by id or name.
- `hooks/drill.ts`: the details view's subagent tree, path back up and per-line sums, and the request rows a saved session keeps.
- `hooks/format.ts`: number, dollar, time, model-name and one-line text formatting.
- `types/index.d.ts`: the state contract (`requests`, `totals`, `ledger`, `view`, `days`, `stats`, `names`, `rollup`, `compare`, `drill`: the session and subagent path the details view shows).
- `hooks/*.test.ts(x)`: run with `claude plugin test plugins/session-cost`.
- `PRIVACY.md`: the privacy policy (`privacyPolicyUrl` in `plugin.json`).
