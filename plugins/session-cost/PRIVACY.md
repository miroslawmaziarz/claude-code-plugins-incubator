# session-cost privacy policy

session-cost is a Claude Code mod that shows the tokens and cost of a session's model requests. This policy covers what it collects, where that data is kept and what it sends.

## What it collects

For each model request, it collects metadata only: token counts, model, effort, start and end time, stop reason, the names of the tools called, whether a subagent made the request, and the turn and subagent IDs Claude Code assigns. For each subagent it also keeps its type (such as `Explore`) and which agent started it; it does not read the subagent's prompt. It also reads the session's running cost and its start time. The cross-session history is stored under the session's ID: its totals by day, a rollup of its requests, tokens and cost by kind, model and subagent, used to compare sessions, and its newest 200 requests, used to show a past session's details. Each saved request keeps only its numbers: sequence number, end time, duration, kind, subagent ID, model, token counts and cost; not its turn ID, effort, stop reason or tool names.

To name each session in its history, it keeps the session's title and the first prompt you send, cut to 60 characters. The title comes from the session's transcript: the mod reads the transcript's newest part and keeps only the title rows (`/rename` and the title Claude Code generates), skipping every other row unparsed.

It does not read responses, tool inputs, tool results or any other of your files. The one other exception is its own `plugin.json`, which it reads to show its installed version in the pane.

With the `cacheTtlSplit` setting on (it is off by default), it also reads the session's transcript files that Claude Code keeps under `~/.claude/projects/`. Those files hold the conversation, but the mod takes only the token counts of each response from them (how many cache-write tokens used the 1-hour and the 5-minute lifetime). It keeps only those counts and nothing else from the files.

With the `stats` setting on (off by default), it also builds a usage profile of the session from the same metadata (costs, cache-write split, gaps between requests, durations, tool names). The profile stays in the session's plugin state and is not saved to history.

## Where it is kept

The data stays on your computer. It lives in the session's plugin state and the plugin's local store inside Claude Code. Per-day history, with each session's rollup and saved requests, is pruned after `historyDays` days (30 by default). `/session-cost reset` deletes the current session's saved history entry, name included.

## What it sends

Nothing. The mod makes no network requests of any kind.

No data is sent to the author or to any other third party. There is no analytics or telemetry.

## Contact

Questions go to the repository's issue tracker: https://github.com/kKEo/claude-code-plugins-incubator/issues
