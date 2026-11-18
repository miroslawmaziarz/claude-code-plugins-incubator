# session-cost

Lists the session's model requests, newest first, in a pane beside the chat, with the tokens and cost of each. Every request is recorded the whole time, whether the pane is open or not; the pane draws the newest 300, and the totals count all of them. Each entry shows the model, whether it came from the main conversation, a subagent or a compaction, how long it took, written on a short bar that compares it to the slowest request on the list, the input, output and cache token counts, and two costs: the request's share of the `/cost` total and an estimate from list prices. The header sums the session. A **Models** view breaks the totals down by model, a **History** view shows today, the last 7 days, the last 30 days by default and recent sessions, and a **Days** view splits spend by calendar day: this session beside all sessions, so a session left open for several days is counted on the days it actually spent. A **Compare** view sets two sessions side by side, with the change from the first to the second on every figure, and a session's details (`›` in History) show what its main conversation and each subagent spent. The header shows the installed version. A short summary such as `$0.544 · 3 req · 130k tok` appears under the prompt and in a chip above it.

![Workflow of session-cost: a model request ends, the mod records its tokens, costs it and adds it to the totals](../images/workflow-session-cost.svg)

## What to type

The cost of the session so far shows under the prompt. For the details:

```
/session-cost
/session-cost days
/session-cost compare "first try" "second try"
/session-cost reset
```

The first opens the pane with one row per request. `days` opens it on spend by calendar day. `compare` sets two sessions side by side, each named by its id, an id prefix or its name (quoted when it has spaces), with the change from the first to the second on every figure; `/session-cost compare` alone opens the Compare view, where you pick the two in History. `reset` starts this session's count again.

## How it works

![How session-cost works: when a model request ends the mod records it, costs it from the /cost total and list prices, adds it to the totals, saves them in the plugin store and draws the pane, the status line and the chip](../images/how-session-cost.svg)

The numbers match the picture.

1. **Record it.** When a model request ends, the mod notes the model, where the request came from, how long it took and its token counts.
2. **Cost it.** It gives the request its share of the increase in the `/cost` total, and an estimate from list prices.
3. **Add it up** into totals per session, per model and per calendar day. The totals are saved in the plugin's store and drawn in the pane, the status line and the chip.

## Details

`/session-cost` toggles the pane (`on` and `off` do so explicitly), `/session-cost requests`, `models`, `history`, `days` or `compare` opens it on that view, `/session-cost compare A B` compares two sessions, and `/session-cost reset` clears this session's requests, totals and day split, and the history entry saved for it. To toggle it from the keyboard, bind a chord to the `app:toggleReplTab` action in `~/.claude/keybindings.json` (for example `ctrl+x c` in the `Global` context). The chord works only while the chip is on and no dialog is open, so keep the chip on. Collapsing the band above the prompt hides the chip but keeps the chord working. The chip's button performs the same toggle. If `app:toggleReplTab` already does something in your setup, choose another action under *Toggle key action* in `/config` and bind that one instead.

Five switches in `/config` change the mod. *Open pane at start* (off by default) opens the pane when a session starts. *Cost status line* and *Cost chip above the prompt* (both on by default) show the summary under the prompt and the chip; switch either off to hide it. *Toggle key action* picks the action the keyboard toggle uses. *History days* (30) sets how many days of totals are kept. Like plan-progress, this is a *mod*.

## What it reads and writes

It reads the session's `/cost` total and each request's token counts and model name, the first prompt you send, and the title rows of the session's transcript (nothing else in it). Totals per session and per day, each session's name, a breakdown by kind, model and subagent, and its newest 200 requests (numbers only) are kept in the plugin's store. It makes no network requests. [Trust and privacy](../trust.md) has the full account.

## Install

```
/plugin install session-cost@km-plugin-registry
```

The marketplace has to be added first; see the [Quick start](../quick-start.md).
