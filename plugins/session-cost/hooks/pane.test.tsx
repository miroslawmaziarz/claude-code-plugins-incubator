import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

/** A found element's children, as the bar test walks them (FoundElement types them as unknown). */
type Node = { type: string; props?: Record<string, unknown>; children: (Node | string)[] }

const PANE = {
  plugin: 'session-cost',
  component: 'Pane',
  requestId: 'session-cost',
  props: {
    title: 'Session cost',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'session-cost',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 6 },
    view: {},
  },
} as const

/** The engine beneath the plugin: a /cost ledger the test moves, panes, store and clock. */
function engine(on: On, store: Record<string, unknown> = {}) {
  const state = { usd: 0.5, open: false, id: 'sess-1', stepMs: [] as number[], stepTools: [] as string[][], stepCache: [] as { read: number; write: number }[], now: 1_800_000_000_000 }
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  // The plugin's store in memory, which a test reads back as the engine would keep it.
  const saved: Record<string, unknown> = structuredClone(store)
  on('store.get', (_, e) => ({ value: saved[e.key] }))
  on('store.set', (_, e) => { saved[e.key] = structuredClone(e.value); return { value: undefined } })
  on('store.delete', (_, e) => { delete saved[e.key]; return { value: undefined } })
  on('store.keys', () => ({ value: Object.keys(saved) }))
  on('command.register', () => ({ value: { command: 'session-cost' } }))
  on('ui.open', () => { state.open = true; return { value: { isPlaced: true } } })
  on('ui.close', () => { state.open = false; return { value: undefined } })
  on('ui.panes', () => ({ value: state.open ? [{ id: 'session-cost', title: 'Session cost', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: state.id }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], cost: { usd: state.usd } } as never }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  // A spawned subagent's id names its type, so a test can step as it: `agent-explore-1`.
  let spawned = 0
  on('agent.spawn', (_, e) => ({ model: 'claude-haiku-5-5', agentId: `agent-${e.subagentType.toLowerCase()}-${++spawned}` }))
  // The engine's own band beneath the plugin: empty.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('turn.step', async function* (_, e) {
    // A test queues how long each request takes; the mocked clock moves by that much.
    const ms = state.stepMs.shift()
    if (ms !== undefined) await clock.set((state.now += ms))
    // The engine adds the response's cost to the ledger as it streams.
    state.usd += e.agentId ? 0.004 : 0.02
    // A test queues the tools each response calls; none queued is a plain answer.
    const tools = state.stepTools.shift() ?? []
    // A test queues what each request read from and wrote to the cache; the default is read-heavy.
    const cache = state.stepCache.shift() ?? { read: 40_000, write: 2000 }
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: tools.map(name => ({ name, input: {} })),
      stopReason: tools.length > 0 ? ('tool_use' as const) : ('end_turn' as const),
      usage: { model: e.agentId ? 'claude-haiku-5-5' : 'claude-opus-5-5', input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: cache.read, cache_creation_input_tokens: cache.write },
    }
  })
  return { state, clock, store: saved }
}

async function step($: Engine, index: number, agentId?: string, effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | number) {
  const stream = $.turn.step({
    turnId: 'turn-1',
    index,
    model: 'claude-opus-5-5',
    messageCount: 3,
    ...(agentId ? { agentId } : {}),
    ...(effort === undefined ? {} : { effort }),
  })
  for await (const _ of stream) {
    // drain
  }
}

test('every request is recorded with its ledger share and estimate, and the pane shows them', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step($, 0)
  await step($, 1)
  await step($, 2, 'agent-abc123')
  await $.turn.complete({ turnId: 'turn-1', answer: 'done', durationMs: 10, isAborted: false, reason: 'answer' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    // Ledger total includes the 0.50 spent before the mod loaded; the rows hold only their own.
    expect(await ui.find({ type: 'Text', text: /\$0\.544/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /3 req/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /#1 / })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /sub:agent-/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$0\.020/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /est \$0\.029/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /unattributed \$0\.500/ })).toBeDefined()

    await ui.press({ key: 'view:models' })
    expect(await ui.find({ type: 'Text', text: /haiku-5-5/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /opus-5-5/ })).toBeDefined()

    await ui.press({ key: 'view:history' })
    expect(await ui.find({ type: 'Text', text: /This session/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Today/ })).toBeDefined()
    await ui.press({ key: 'view:requests' })
    await ui.unmount()
  }
})

test('a request row shows the effort it asked for, and none when it asked for none', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step($, 0, undefined, 'xhigh')
  await step($, 1, 'agent-abc123', 'low')
  await step($, 2)
  await $.turn.complete({ turnId: 'turn-1', answer: 'done', durationMs: 10, isAborted: false, reason: 'answer' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^#1 / }))?.text).toMatch(/opus-5-5 xhigh main/)
    expect((await ui.find({ type: 'Text', text: /^#2 / }))?.text).toMatch(/haiku-5-5 low sub:agent-/)
    expect((await ui.find({ type: 'Text', text: /^#3 / }))?.text).toMatch(/opus-5-5 main/)
    await ui.unmount()
  }
})

test('the chip above the prompt carries the toggle on the configured action', async ($, on) => {
  const { state } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step($, 0)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /1 req/ })).toBeDefined()
  const button = await ui.find({ type: 'Button', key: 'session-cost-toggle' })
  expect(button?.props.action).toBe('app:toggleReplTab')
  await ui.press({ key: 'session-cost-toggle' })
  expect(state.open).toBe(true)
  await ui.press({ key: 'session-cost-toggle' })
  expect(state.open).toBe(false)
  await ui.unmount()
})

test('a collapsed band drops the cost text but keeps the toggle mounted', async ($, on) => {
  const { state } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step($, 0)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, isCollapsed: true }, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /req/ })).toBeUndefined()
  const button = await ui.find({ type: 'Button', key: 'session-cost-toggle' })
  expect(button?.props.action).toBe('app:toggleReplTab')
  await ui.press({ key: 'session-cost-toggle' })
  expect(state.open).toBe(true)
  await ui.unmount()
})

test('the slash command toggles the pane, switches views and resets', async ($, on) => {
  const { state } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step($, 0)
  const run = (args: string) =>
    $.command.run({ command: 'session-cost', args, origin: { kind: 'unclassified' }, presentation: { isFullscreen: true, columns: 160 } })

  expect((await run('')).text).toMatch(/opened/)
  expect(state.open).toBe(true)
  expect((await run('')).text).toMatch(/closed/)
  expect(state.open).toBe(false)
  expect((await run('models')).text).toMatch(/models view/)
  expect(state.open).toBe(true)

  expect((await run('reset')).text).toMatch(/cleared/)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /0 req/ })).toBeDefined()
  await ui.unmount()
})

test('after a reset, the saved history holds only what the session spent since', async ($, on) => {
  const { state } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const run = (args: string) =>
    $.command.run({ command: 'session-cost', args, origin: { kind: 'unclassified' }, presentation: { isFullscreen: true, columns: 160 } })
  const done = () => $.turn.complete({ turnId: 'turn-1', answer: 'done', durationMs: 10, isAborted: false, reason: 'answer' })

  await step($, 0)
  await done()
  await run('reset')
  await step($, 1)
  await done()

  // Seen from a later session, sess-1's saved row holds the one request after the reset.
  state.id = 'sess-2'
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'view:history' })
  const saved = await ui.find({ type: 'Text', text: /sess-1/ })
  expect(saved?.text).toMatch(/\$0\.020\s+1 req/)
  await ui.unmount()
})

test('a reset with no request after it leaves nothing in history', async ($, on) => {
  const { state } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step($, 0)
  await $.turn.complete({ turnId: 'turn-1', answer: 'done', durationMs: 10, isAborted: false, reason: 'answer' })
  await $.command.run({ command: 'session-cost', args: 'reset', origin: { kind: 'unclassified' }, presentation: { isFullscreen: true, columns: 160 } })

  state.id = 'sess-2'
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'view:history' })
  expect(await ui.find({ type: 'Text', text: /This session/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /sess-1/ })).toBe(undefined)
  await ui.unmount()
})

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } as const })
const done = ($: Engine) => $.turn.complete({ turnId: 'turn-1', answer: 'done', durationMs: 10, isAborted: false, reason: 'answer' })

/** The Recent sessions row of a saved session, as a later session's History tab shows it. */
async function recentRow($: Engine, id: string) {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'view:history' })
  const found = await ui.find({ type: 'Text', text: new RegExp(id) })
  await ui.unmount()
  return found?.text
}

test('a session without a title is named in Recent sessions by its first prompt', async ($, on) => {
  const { state } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit(typed('Clone   the incubator\nrepo please'))
  await step($, 0)
  await done($)
  await $.prompt.submit(typed('and now something else'))
  await step($, 1)
  await done($)

  state.id = 'sess-2'
  expect(await recentRow($, 'sess-1')).toMatch(/2 req sess-1\s+Clone the incubator repo please$/)
})

/** A transcript the test writes to, read by the mod as the engine's file system would. */
function transcript(on: On) {
  const dir = '/home/u/.claude/projects/p/'
  const files: Record<string, string> = { [`${dir}sess-1.jsonl`]: '' }
  const file = { path: `${dir}sess-1.jsonl` }
  on('session.info', () => ({ value: { transcriptPath: file.path } }))
  on('fs.stat', (_, e) => (files[e.path] !== undefined ? { value: { kind: 'file', size: files[e.path]!.length, mtimeMs: 0, isLink: false } } : { deny: 'ENOENT' }))
  on('fs.read', (_, e) => {
    const text = files[e.path]
    if (text === undefined) return { deny: 'ENOENT' }
    const from = e.offset ?? 0
    return { value: text.slice(from, e.length === undefined ? undefined : from + e.length) }
  })
  /** Appends a row to the session's transcript (`id`'s, else the current one). */
  const append = (row: object, id?: string) => {
    const path = id === undefined ? file.path : `${dir}${id}.jsonl`
    files[path] = (files[path] ?? '') + JSON.stringify(row) + '\n'
  }
  /** Points the session's transcript at `id`'s file, as a /clear does. */
  const switchTo = (id: string) => {
    file.path = `${dir}${id}.jsonl`
    files[file.path] ??= ''
  }
  return { file, append, switchTo }
}

test('after /clear the ended session keeps the titles of its own transcript, and the next one reads its file from the start', async ($, on) => {
  const { state } = engine(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  const { append, switchTo } = transcript(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit(typed('first prompt'))
  await step($, 0)
  append({ type: 'ai-title', aiTitle: 'Old title' })
  await done($)
  // Renamed after its last turn; by the time session.end runs, the transcript path names the new conversation's file.
  append({ type: 'custom-title', customTitle: 'Renamed old' })
  append({ type: 'ai-title', aiTitle: 'New title' }, 'sess-2')
  switchTo('sess-2')
  await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: { id: 'sess-1' } })

  state.id = 'sess-2'
  await $.prompt.submit(typed('second prompt'))
  await step($, 1)
  await done($)

  state.id = 'sess-3'
  expect(await recentRow($, 'sess-1')).toMatch(/sess-1\s+Renamed old$/)
  expect(await recentRow($, 'sess-2')).toMatch(/sess-2\s+New title$/)
})

test('a reset forgets the session\'s name too, so the saved entry does not bring it back', async ($, on) => {
  const { state, store } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit(typed('before the reset'))
  await step($, 0)
  await done($)
  await runCommand($, 'reset')
  await step($, 1)
  await done($)
  expect((store['session:sess-1'] as { name?: string }).name).toBeUndefined()

  await $.prompt.submit(typed('after the reset'))
  await done($)
  state.id = 'sess-2'
  expect(await recentRow($, 'sess-1')).toMatch(/sess-1\s+after the reset$/)
})

test('names in Recent sessions start in one column, a long one cut short, and a session with none shows its id alone', async ($, on) => {
  const saved = { startedAt: 0, ledgerUsd: 1, estUsd: 1, requests: 5, input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }
  const now = 1_800_000_000_000
  engine(on, {
    'session:a': { ...saved, lastAt: now - 3000, name: 'Short' },
    'session:0123456789abcdef': { ...saved, lastAt: now - 2000 },
    'session:old-one': { ...saved, lastAt: now - 1000 },
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'view:history' })
  // The id takes 8 cells, padded or cut, then two spaces before the name.
  expect((await ui.find({ type: 'Text', text: /Short$/ }))?.text).toMatch(/5 req a {9}Short$/)
  expect((await ui.find({ type: 'Text', text: /old-one/ }))?.text).toMatch(/5 req old-one$/)
  expect((await ui.find({ type: 'Text', text: /01234567/ }))?.text).toMatch(/5 req 01234567$/)
  await ui.unmount()
})

test('after /clear the next conversation is named by its own first prompt, and only the person\'s prompts name one', async ($, on) => {
  const { state } = engine(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'a message from a peer', wait: false, origin: { kind: 'peer', from: 'x' } as never })
  await $.prompt.submit(typed('First conversation'))
  await step($, 0)
  await done($)
  await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: { id: 'sess-1' } })

  state.id = 'sess-2'
  await $.prompt.submit(typed('Second conversation'))
  await step($, 1)
  await done($)

  state.id = 'sess-3'
  expect(await recentRow($, 'sess-1')).toMatch(/sess-1\s+First conversation$/)
  expect(await recentRow($, 'sess-2')).toMatch(/sess-2\s+Second conversation$/)
})

test('a long first prompt is kept cut short, ending in an ellipsis', async ($, on) => {
  const { state } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit(typed(`Explain ${'very '.repeat(30)}carefully`))
  await step($, 0)
  await done($)
  state.id = 'sess-2'
  const name = (await recentRow($, 'sess-1'))?.replace(/^.*? req sess-1\s+/, '') ?? ''
  expect(name).toMatch(/^Explain very very .*…$/)
  expect(name.length).toBe(60)
})

test('a title from the transcript names the session over its first prompt, a custom one over an AI one', async ($, on) => {
  const { state } = engine(on)
  const { append } = transcript(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  append({ type: 'user', message: { role: 'user', content: 'Clone the incubator repo' }, sessionId: 'sess-1' })
  await $.prompt.submit(typed('Clone the incubator repo'))
  await step($, 0)
  append({ type: 'ai-title', aiTitle: 'Cloning the incubator', sessionId: 'sess-1' })
  await done($)
  state.id = 'sess-2'
  expect(await recentRow($, 'sess-1')).toMatch(/sess-1\s+Cloning the incubator$/)

  state.id = 'sess-1'
  append({ type: 'custom-title', customTitle: 'incubator', sessionId: 'sess-1' })
  append({ type: 'ai-title', aiTitle: 'Cloning and testing the incubator', sessionId: 'sess-1' })
  await step($, 1)
  await done($)
  state.id = 'sess-2'
  expect(await recentRow($, 'sess-1')).toMatch(/sess-1\s+incubator$/)
})

/** Local time on a January 2027 day, after the mocked clock's start in any time zone. */
const jan = (d: number, h: number) => new Date(2027, 0, d, h).getTime()

test('a session that crosses midnight is split by day in History, and the old days view lands there', async ($, on) => {
  // An older session saved before days were kept: it counts whole on its last day.
  const old = { startedAt: jan(16, 9), lastAt: jan(16, 10), ledgerUsd: 1, estUsd: 1, requests: 5, input: 1, output: 1, cacheRead: 1, cacheWrite: 1 }
  const { clock } = engine(on, { 'session:old': old })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.set(jan(15, 23))
  await step($, 0)
  await clock.set(jan(16, 1))
  await step($, 1)
  await step($, 2)
  await $.turn.complete({ turnId: 'turn-1', answer: 'done', durationMs: 10, isAborted: false, reason: 'answer' })

  const run = (args: string) =>
    $.command.run({ command: 'session-cost', args, origin: { kind: 'unclassified' }, presentation: { isFullscreen: true, columns: 160 } })
  expect((await run('days')).text).toMatch(/history view/)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const sat = await ui.find({ type: 'Text', text: /Sat 16 Jan/ })
    expect(sat?.text).toMatch(/\$0\.040\s+2 req\s+\$1\.040\s+2 sess/)
    expect(sat?.text).toMatch(/today/)
    expect((await ui.find({ type: 'Text', text: /Fri 15 Jan/ }))?.text).toMatch(/\$0\.020\s+1 req\s+\$0\.020\s+1 sess/)
    expect(await ui.find({ type: 'Text', text: /spans 2 days/ })).toBeDefined()

    expect(await ui.find({ type: 'Text', text: /^By day$/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^Today/ }))?.text).toMatch(/\$1\.040\s+7 req/)
    expect((await ui.find({ type: 'Text', text: /^Last 7 days/ }))?.text).toMatch(/\$1\.060\s+8 req/)

    await ui.press({ key: 'view:requests' })
    expect(await ui.find({ type: 'Text', text: /── Fri 15 Jan ──/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /── Sat 16 Jan ──/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'view:days' })).toBeUndefined()
    await ui.press({ key: 'view:history' })
    await ui.unmount()
  }
})

test('each request row carries a 7-cell bar scaled to the slowest request, with its duration on it', async ($, on) => {
  const { state } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  state.stepMs.push(1000, 4000, 2000)
  await step($, 0)
  await step($, 1)
  await step($, 2)
  await $.turn.complete({ turnId: 'turn-1', answer: 'done', durationMs: 10, isAborted: false, reason: 'answer' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const bar = async (seq: number) => {
      const row = await ui.find({ type: 'Text', text: new RegExp(`^#${seq} `) })
      const kids = (row?.children ?? []) as (Node | string)[]
      const strip = kids.find(c => typeof c !== 'string' && c.type === 'Text' && c.children.some(cc => typeof cc !== 'string' && cc.props?.backgroundColor))
      const [fill, track] = (typeof strip === 'string' ? [] : strip?.children ?? []).filter((c): c is Node => typeof c !== 'string')
      const text = (el: typeof fill) => (typeof el === 'string' || !el ? undefined : el.children.join(''))
      return { fill: text(fill), track: text(track), color: fill?.props?.backgroundColor, trackColor: track?.props?.backgroundColor }
    }
    // #2 is the slowest (4.0s): full and highlighted.
    expect(await bar(2)).toEqual({ fill: '   4.0s', track: '', color: 'warning', trackColor: 'subtle' })
    expect(await bar(3)).toEqual({ fill: '   2', track: '.0s', color: 'suggestion', trackColor: 'subtle' })
    expect(await bar(1)).toEqual({ fill: '  ', track: ' 1.0s', color: 'suggestion', trackColor: 'subtle' })
    await ui.unmount()
  }
})

test('a request with no measured time shows no bar', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step($, 0)
  await $.turn.complete({ turnId: 'turn-1', answer: 'done', durationMs: 10, isAborted: false, reason: 'answer' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(JSON.stringify(await ui.find({ type: 'Text', text: /^#1 / }))).not.toContain('backgroundColor')
  await ui.unmount()
})

test('a request that called tools names them in place of the bare stop reason', async ($, on) => {
  const { state } = engine(on)
  state.stepTools.push(['Read', 'mcp__github__create_issue', 'Read'], [])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step($, 0)
  await step($, 1)
  await $.turn.complete({ turnId: 'turn-1', answer: 'done', durationMs: 10, isAborted: false, reason: 'answer' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const called = (await ui.find({ type: 'Text', text: /^#1 / }))?.text
    expect(called).toMatch(/→ Read ×2, create_issue/)
    expect(called).not.toMatch(/tool_use/)
    expect((await ui.find({ type: 'Text', text: /^#2 / }))?.text).toMatch(/end_turn/)
    await ui.unmount()
  }
})

test('cache reads are green and cache writes red, more vivid the larger their share of the prompt', async ($, on) => {
  const { state } = engine(on)
  // Newest first in the pane: #3 neither read nor wrote, #2 mostly wrote, #1 mostly read.
  state.stepCache.push({ read: 40_000, write: 2000 }, { read: 800, write: 38_000 }, { read: 0, write: 0 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step($, 0)
  await step($, 1)
  await step($, 2)
  await $.turn.complete({ turnId: 'turn-1', answer: 'done', durationMs: 10, isAborted: false, reason: 'answer' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const reads = await ui.findAll({ type: 'Text', text: /^cr / })
    const writes = await ui.findAll({ type: 'Text', text: /^cw / })
    expect(reads.map(r => r.props.color)).toEqual([undefined, '#9bd3a4', '#0a8a2a'])
    expect(writes.map(w => w.props.color)).toEqual([undefined, '#d01919', '#e3a6a6'])
    // A zero count has no hue: it is dimmed instead.
    expect(reads[0]?.props.dimColor).toBe(true)
    expect(reads[2]?.props.dimColor).toBe(false)
    await ui.unmount()
  }
})

test('every tab shows the installed version in its header', async ($, on) => {
  engine(on)
  on('fs.read', () => ({ value: '{"name":"session-cost","version":"0.4.0"}' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Button', key: 'view:version' })).toBeUndefined()
    for (const tab of ['requests', 'models', 'history']) {
      await ui.press({ key: `view:${tab}` })
      expect(await ui.find({ type: 'Text', text: /v0\.4\.0/ })).toBeDefined()
    }
    await ui.unmount()
  }
})

/** A transcript holding the default step's usage, written with `oneHour` of its 2000 cache-write tokens at 1 hour. */
function transcriptLine(oneHour: number, model = 'claude-opus-5-5'): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      model,
      usage: {
        input_tokens: 1200,
        output_tokens: 300,
        cache_read_input_tokens: 40_000,
        cache_creation_input_tokens: 2000,
        cache_creation: { ephemeral_1h_input_tokens: oneHour, ephemeral_5m_input_tokens: 2000 - oneHour },
      },
    },
  })
}

function transcripts(on: On, files: Record<string, string>) {
  const reads: string[] = []
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('session.root', () => ({ value: '/srv/app' }))
  on('fs.read', (_, e) => {
    reads.push(e.path)
    const text = files[e.path]
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  return reads
}

test('with the TTL split on, rows say 1h or 5m from the transcript and the estimate prices 1h at 2×', { options: { cacheTtlSplit: true } }, async ($, on) => {
  engine(on)
  transcripts(on, {
    '/home/me/.claude/projects/-srv-app/sess-1.jsonl': transcriptLine(2000),
    '/home/me/.claude/projects/-srv-app/sess-1/subagents/agent-agent-abc123.jsonl': transcriptLine(0, 'claude-haiku-5-5'),
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step($, 0)
  await step($, 1, 'agent-abc123')
  await $.turn.complete({ turnId: 'turn-1', answer: 'done', durationMs: 10, isAborted: false, reason: 'answer' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const labels = await ui.findAll({ type: 'Text', text: /^ (1h|5m)$/ })
    // Newest first: the subagent's 5-minute write, then the main thread's 1-hour one.
    expect(labels.map(l => l.text)).toEqual([' 5m', ' 1h'])
    // Opus 5.5 main row: 1200 × $4 + 300 × $20 + 40k × $0.20 + 2000 × $8 per million = $0.0348.
    expect(await ui.find({ type: 'Text', text: /est \$0\.035/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\(1h 2k\)/ })).toBeDefined()
    await ui.unmount()
  }
})

test('with the TTL split off, no transcript is read and rows keep the plain cache-write count', async ($, on) => {
  engine(on)
  const reads = transcripts(on, { '/home/me/.claude/projects/-srv-app/sess-1.jsonl': transcriptLine(2000) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step($, 0)
  await $.turn.complete({ turnId: 'turn-1', answer: 'done', durationMs: 10, isAborted: false, reason: 'answer' })

  expect(reads.filter(p => p.endsWith('.jsonl'))).toEqual([])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^ (1h|5m)$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /est \$0\.029/ })).toBeDefined()
  await ui.unmount()
})

test('a transcript line that lands after the step is picked up a second later', { options: { cacheTtlSplit: true } }, async ($, on) => {
  const { clock } = engine(on)
  const files: Record<string, string> = {}
  transcripts(on, files)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step($, 0)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^ 1h$/ })).toBeUndefined()

  files['/home/me/.claude/projects/-srv-app/sess-1.jsonl'] = transcriptLine(2000)
  await clock.set(1_800_000_000_000 + 1500)
  await ui.unmount()
  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await again.find({ type: 'Text', text: /^ 1h$/ })).toBeDefined()
  await again.unmount()
})

const run = ($: Engine, args: string) =>
  $.command.run({ command: 'session-cost', args, origin: { kind: 'unclassified' }, presentation: { isFullscreen: true, columns: 160 } })

test('with stats off there is no Stats tab and the command says how to turn it on', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step($, 0)
  expect((await run($, 'stats')).text).toMatch(/stats are off/)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Button', key: 'view:stats' })).toBeUndefined()
    await ui.unmount()
  }
})

test('with stats on, the Stats tab profiles cost, cache TTL, idle gaps and requests', { options: { stats: true, cacheTtlSplit: true } }, async ($, on) => {
  const { state, clock } = engine(on)
  transcripts(on, { '/home/me/.claude/projects/-srv-app/sess-1.jsonl': transcriptLine(2000) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  state.stepTools.push(['Read', 'Read', 'Bash'])
  await step($, 0)
  // A 10-minute pause, bridged by the first request's 1-hour write.
  await clock.set((state.now += 10 * 60 * 1000))
  await step($, 1)
  await step($, 2, 'agent-abc123')
  await $.turn.complete({ turnId: 'turn-1', answer: 'done', durationMs: 10, isAborted: false, reason: 'answer' })

  expect((await run($, 'stats')).text).toMatch(/stats view/)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^Cost breakdown/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ +write 1h/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /writes 1h/ }))?.text).toMatch(/writes 1h 4k · 5m 0 · \? 2k/)
    expect((await ui.find({ type: 'Text', text: /5–60m/ }))?.text).toMatch(/<5m 0 · 5–60m 1 · >60m 0/)
    expect((await ui.find({ type: 'Text', text: /kept by 1h/ }))?.text).toMatch(/kept by 1h 1/)
    expect(await ui.find({ type: 'Text', text: /1h net/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^ +3 · main 2 · sub 1/ }))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /tools/ }))?.text).toMatch(/Read 2 · Bash 1/)
    await ui.unmount()
  }

  expect((await run($, 'reset')).text).toMatch(/cleared/)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Stats gather from the next request/ })).toBeDefined()
  await ui.unmount()
})

/** Dollars to a tenth of a cent, so sums of ledger shares compare exactly. */
const cents = (x: number) => Math.round(x * 1000) / 1000

/** Starts a subagent of `type` the way the model's Agent call would, and answers its id. */
async function spawn($: Engine, type: string, parentAgentId?: string): Promise<string> {
  const r = await $.agent.spawn({
    ...(parentAgentId === undefined ? {} : { parentAgentId }),
    prompt: 'go',
    description: 'task',
    subagentType: type,
    tool_use_id: 'toolu_1',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  })
  return r.agentId ?? ''
}

test('a session keeps a rollup in its saved history: by kind, by model and by subagent with its type', async ($, on) => {
  const { state, store } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  state.stepMs.push(1000, 2000, 3000)
  await step($, 0)
  const explore = await spawn($, 'Explore')
  await step($, 1, explore)
  await step($, 2)
  await done($)

  const saved = store['session:sess-1'] as Record<string, any>
  const r = saved.rollup
  expect(r.byKind.main.requests).toBe(2)
  expect(r.byKind.subagent.requests).toBe(1)
  expect(r.byKind.compact.requests).toBe(0)
  expect(cents(r.byKind.main.ledgerUsd)).toBe(0.04)
  expect(cents(r.byKind.subagent.ledgerUsd)).toBe(0.004)
  expect(r.byModel['claude-haiku-5-5'].requests).toBe(1)
  expect(r.byModel['claude-opus-5-5'].output).toBe(600)
  expect(r.byAgent[explore]).toMatchObject({ type: 'Explore', requests: 1, input: 1200, durationMs: 2000 })
  expect(cents(r.byAgent[explore].ledgerUsd)).toBe(0.004)
  // Wall clock runs from the first request's start to the last one's end; request time is their sum.
  expect(r.lastAt - r.firstAt).toBe(6000)
  expect(r.durationMs).toBe(6000)
  // Kept request rows carry no turn ids.
  expect(JSON.stringify(saved)).not.toContain('turnId')
})

const NOW = 1_800_000_000_000
const bucket = (requests: number, usd: number, input = 1000 * requests, durationMs = 2000 * requests) => ({
  input,
  output: 100 * requests,
  cacheRead: 0,
  cacheWrite: 0,
  requests,
  estUsd: usd,
  ledgerUsd: usd,
  durationMs,
})
const NONE = bucket(0, 0)

/** One agent doing the whole task on Opus: 4 main requests, $1.00, 10 minutes. */
const SOLO = {
  startedAt: NOW - 3_600_000, lastAt: NOW - 3_000_000, ledgerUsd: 1, estUsd: 1, requests: 4, input: 4000, output: 400, cacheRead: 4000, cacheWrite: 4000, name: 'solo opus run',
  rollup: {
    firstAt: NOW - 3_600_000, lastAt: NOW - 3_000_000, durationMs: 8000,
    byKind: { main: bucket(4, 1), subagent: NONE, compact: NONE },
    byModel: { 'claude-opus-5-5': bucket(4, 1) },
    byAgent: {},
  },
}

/** The same task split across subagents: 2 main, 2 Explore and 1 Plan requests, $0.50, 5 minutes. */
const TEAM = {
  startedAt: NOW - 2_000_000, lastAt: NOW - 1_700_000, ledgerUsd: 0.5, estUsd: 0.5, requests: 5, input: 5000, output: 500, cacheRead: 16000, cacheWrite: 4000, name: 'team sonnet run',
  rollup: {
    firstAt: NOW - 2_000_000, lastAt: NOW - 1_700_000, durationMs: 10000,
    byKind: { main: bucket(2, 0.3), subagent: bucket(3, 0.2), compact: NONE },
    byModel: { 'claude-sonnet-5-5': bucket(2, 0.3), 'claude-haiku-5-5': bucket(3, 0.2) },
    byAgent: {
      'agent-e1': { ...bucket(1, 0.05), type: 'Explore' },
      'agent-e2': { ...bucket(1, 0.05), type: 'Explore' },
      'agent-p1': { ...bucket(1, 0.1), type: 'Plan' },
    },
  },
}

const runCommand = ($: Engine, args: string) =>
  $.command.run({ command: 'session-cost', args, origin: { kind: 'unclassified' }, presentation: { isFullscreen: true, columns: 160 } })

type Mounted = { find: (q: { type: 'Text'; text?: RegExp }) => Promise<{ text?: string; children: unknown[] } | undefined> }

/** A metric row of the Compare view, by its label: its whole text and the color of its B−A and % cells. */
async function metric(ui: Mounted, label: string) {
  const row = await ui.find({ type: 'Text', text: new RegExp(`^${label.replace(/[$/.]/g, '\\$&')}\\s`) })
  const cells = (row?.children ?? []).filter((c): c is Node => typeof c === 'object' && c !== null)
  return { text: row?.text, color: cells.at(-1)?.props?.color }
}

test('the compare command sets two saved sessions side by side by name, with B−A and % on every metric', async ($, on) => {
  const { state } = engine(on, { 'session:aaaa1111': SOLO, 'session:bbbb2222': TEAM })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await runCommand($, 'compare solo "team sonnet run"')).text).toMatch(/compare view/)
  expect(state.open).toBe(true)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^A / }))?.text).toMatch(/aaaa1111.*solo opus run/)
    expect((await ui.find({ type: 'Text', text: /^B / }))?.text).toMatch(/bbbb2222.*team sonnet run/)
    // Cheaper is better: green.
    expect(await metric(ui, '/cost')).toEqual({ text: expect.stringMatching(/\$1\.000\s+\$0\.500\s+-\$0\.500\s+-50%$/), color: 'success' })
    // More requests is worse: red.
    expect(await metric(ui, 'requests')).toEqual({ text: expect.stringMatching(/4\s+5\s+\+1\s+\+25%$/), color: 'error' })
    // A higher cache hit rate is better: 4000/12000 → 16000/25000.
    expect(await metric(ui, 'cache hit rate')).toEqual({ text: expect.stringMatching(/33%\s+64%\s+\+31pp\s+\+92%$/), color: 'success' })
    expect(await metric(ui, 'wall clock')).toEqual({ text: expect.stringMatching(/10m 00s\s+5m 00s\s+-5m 00s\s+-50%$/), color: 'success' })
    expect((await metric(ui, 'request time')).text).toMatch(/8\.0s\s+10\.0s\s+\+2\.0s\s+\+25%$/)
    // The single-agent run has no subagent side at all.
    expect((await metric(ui, 'sub req')).text).toMatch(/^sub\s.*\s0\s+3\s+\+3\s+—$/)
    expect((await metric(ui, 'main $')).text).toMatch(/\$1\.000\s+\$0\.300\s+-\$0\.700\s+-70%$/)
    expect((await metric(ui, 'opus-5-5 req')).text).toMatch(/opus-5-5.*\s4\s+0\s+-4\s+-100%$/)
    expect((await metric(ui, 'haiku-5-5 req')).text).toMatch(/haiku-5-5.*\s0\s+3\s+\+3\s+—$/)
    // Subagents by type.
    expect((await metric(ui, 'sub:Explore req')).text).toMatch(/^sub:Explore.*\s0\s+2\s+\+2\s+—$/)
    expect((await metric(ui, 'sub:Plan $')).text).toMatch(/^sub:Plan.*\$0\s+\$0\.100\s+\+\$0\.100\s+—$/)
    await ui.unmount()
  }
})

test('marking a Recent sessions row A and then another B opens the comparison, and swap flips baseline and deltas', async ($, on) => {
  engine(on, { 'session:aaaa1111': SOLO, 'session:bbbb2222': TEAM })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const empty = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await empty.press({ key: 'view:compare' })
  expect(await empty.find({ type: 'Text', text: /^—$/ })).toBeDefined()
  await empty.unmount()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    // Marking A starts a new pair, whatever was compared before.
    await ui.press({ key: 'view:history' })
    await ui.press({ key: 'pick:aaaa1111' })
    expect((await ui.find({ type: 'Button', key: 'pick:aaaa1111' }))?.text).toBe('A')
    expect(await ui.find({ type: 'Text', text: /^Recent sessions/ })).toBeDefined()
    await ui.press({ key: 'pick:bbbb2222' })
    expect((await ui.find({ type: 'Text', text: /^A / }))?.text).toMatch(/aaaa1111/)
    expect((await ui.find({ type: 'Text', text: /^B / }))?.text).toMatch(/bbbb2222/)

    await ui.press({ key: 'compare:swap' })
    expect((await ui.find({ type: 'Text', text: /^A / }))?.text).toMatch(/bbbb2222/)
    expect(await metric(ui, '/cost')).toEqual({ text: expect.stringMatching(/\$0\.500\s+\$1\.000\s+\+\$0\.500\s+\+100%$/), color: 'error' })
    expect((await metric(ui, 'sub req')).text).toMatch(/3\s+0\s+-3\s+-100%$/)
    await ui.unmount()
  }
})

test('a session saved before rollups compares on totals, with n/a breakdowns and a note', async ($, on) => {
  const { rollup: _, ...legacy } = SOLO
  engine(on, { 'session:aaaa1111': legacy, 'session:bbbb2222': TEAM })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await runCommand($, 'compare aaaa bbbb')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await metric(ui, '/cost')).text).toMatch(/\$1\.000\s+\$0\.500\s+-\$0\.500\s+-50%$/)
    expect(await metric(ui, 'wall clock')).toEqual({ text: expect.stringMatching(/n\/a\s+5m 00s\s+n\/a\s+n\/a$/), color: undefined })
    expect((await metric(ui, 'sub req')).text).toMatch(/n\/a\s+3\s+n\/a\s+n\/a$/)
    expect((await metric(ui, 'sub:Explore req')).text).toMatch(/n\/a\s+2\s+n\/a\s+n\/a$/)
    expect(await ui.find({ type: 'Text', text: /n\/a for A: saved before session-cost 0\.7\.0/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the compare command says which name it could not place, and compares this session live', async ($, on) => {
  engine(on, { 'session:aaaa1111': SOLO, 'session:aaaa2222': { ...TEAM, name: 'another solo run' } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await runCommand($, 'compare nothing-like-it aaaa1111')).text).toMatch(/no saved session matches "nothing-like-it"/)
  expect((await runCommand($, 'compare aaaa aaaa1111')).text).toMatch(/"aaaa" matches 2 sessions/)
  expect((await runCommand($, 'compare solo')).text).toMatch(/Usage: \/session-cost compare <A> <B>/)

  await $.prompt.submit(typed('the live one'))
  await step($, 0)
  expect((await runCommand($, 'compare "solo opus run" sess-1')).text).toMatch(/compare view/)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^B / }))?.text).toMatch(/sess-1.*the live one/)
  expect((await metric(ui, 'requests')).text).toMatch(/4\s+1\s+-3\s+-75%$/)
  // This session can be marked in History too.
  await ui.press({ key: 'view:history' })
  await ui.press({ key: 'pick:sess-1' })
  await ui.press({ key: 'pick:aaaa1111' })
  expect((await ui.find({ type: 'Text', text: /^A / }))?.text).toMatch(/sess-1/)
  await ui.unmount()
})

test('rollups are pruned with the per-day history they belong to', async ($, on) => {
  const day = 24 * 60 * 60 * 1000
  const old = { ...SOLO, lastAt: NOW - 40 * day, days: { '2020-01-01': { input: 1, output: 1, cacheRead: 1, cacheWrite: 1, requests: 4, estUsd: 1, ledgerUsd: 1, otherUsd: 0 } } }
  const { store } = engine(on, { 'session:aaaa1111': old, 'session:bbbb2222': TEAM })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await done($)
  expect(store['session:aaaa1111']).toBeUndefined()
  expect((store['session:bbbb2222'] as typeof TEAM).rollup.byKind.subagent.requests).toBe(3)
})

/** A session with a subagent that spawned its own: main, Explore, Plan inside Explore, main again. */
async function nestedSession($: Engine) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit(typed('nested run'))
  await step($, 0)
  const explore = await spawn($, 'Explore')
  await step($, 1, explore)
  const plan = await spawn($, 'Plan', explore)
  await step($, 2, plan)
  await step($, 3)
  await done($)
  return { explore, plan }
}

/** The request rows of the details view, by their `#seq`. */
async function requestSeqs(ui: { findAll: (q: { type: 'Text'; text?: RegExp }) => Promise<{ text?: string }[]> }) {
  return (await ui.findAll({ type: 'Text', text: /^#\d+ / })).map(t => (t.text ?? '').split(' ')[0])
}

test('a past session opens from History with its summary, every request and its subagent tree', async ($, on) => {
  const { state } = engine(on)
  const { explore, plan } = await nestedSession($)
  state.id = 'sess-2'

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'view:history' })
    await ui.press({ key: 'open:sess-1' })
    expect((await ui.find({ type: 'Text', text: /^Session sess-1/ }))?.text).toMatch(/nested run/)
    // The summary: the same /cost total Recent sessions shows (with the $0.50 spent before the mod loaded), requests, tokens and cache hit rate.
    expect((await ui.find({ type: 'Text', text: /^total / }))?.text).toMatch(/\$0\.548.*4 req/)
    expect(await ui.find({ type: 'Text', text: /cache hit 93%/ })).toBeDefined()
    // The tree: main's own requests, Explore, and Plan nested under Explore; with what no request took, they add up to the total.
    expect((await ui.find({ type: 'Text', text: /^main / }))?.text).toMatch(/\$0\.040\s+2 req/)
    expect((await ui.find({ type: 'Text', text: /^unattributed / }))?.text).toMatch(/\$0\.500$/)
    expect((await ui.find({ type: 'Button', key: `agent:${explore}` }))?.text).toMatch(/^└ Explore .*\$0\.0040\s+1 req/)
    expect((await ui.find({ type: 'Button', key: `agent:${plan}` }))?.text).toMatch(/^  └ Plan .*\$0\.0040\s+1 req/)
    // Every request, oldest first.
    expect(await requestSeqs(ui)).toEqual(['#1', '#2', '#3', '#4'])
    await ui.unmount()
  }
})

test('a subagent opens into its own details, and back walks up to its parent, the session, then History', async ($, on) => {
  const { state } = engine(on)
  const { explore, plan } = await nestedSession($)
  state.id = 'sess-2'

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'view:history' })
    await ui.press({ key: 'open:sess-1' })
    await ui.press({ key: `agent:${plan}` })
    expect((await ui.find({ type: 'Text', text: /^Session sess-1/ }))?.text).toMatch(new RegExp(`› Explore ${explore.slice(0, 8)} › Plan ${plan.slice(0, 8)}$`))
    expect((await ui.find({ type: 'Text', text: /^total / }))?.text).toMatch(/\$0\.0040.*1 req/)
    expect(await requestSeqs(ui)).toEqual(['#3'])

    await ui.press({ key: 'drill:back' })
    expect((await ui.find({ type: 'Text', text: /^Session sess-1/ }))?.text).toMatch(/› Explore [^›]*$/)
    // Its requests and its subagent's, as the session's list holds its subagents' too.
    expect(await requestSeqs(ui)).toEqual(['#2', '#3'])
    // Its own subagent is listed, one level under it, and can be entered from here too.
    expect((await ui.find({ type: 'Button', key: `agent:${plan}` }))?.text).toMatch(/^└ Plan /)

    await ui.press({ key: 'drill:back' })
    expect((await ui.find({ type: 'Text', text: /^total / }))?.text).toMatch(/4 req/)
    await ui.press({ key: 'drill:back' })
    expect(await ui.find({ type: 'Text', text: /^Recent sessions/ })).toBeDefined()
    // The compare pick still sits on the row.
    expect((await ui.find({ type: 'Button', key: 'pick:sess-1' }))?.text).toBe('·')
    await ui.unmount()
  }
})

test('this session opens live from History, its requests from the pane\'s own rows', async ($, on) => {
  engine(on)
  await nestedSession($)
  await step($, 4)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'view:history' })
  await ui.press({ key: 'open:sess-1' })
  expect((await ui.find({ type: 'Text', text: /^total / }))?.text).toMatch(/\$0\.568.*5 req/)
  expect(await requestSeqs(ui)).toEqual(['#1', '#2', '#3', '#4', '#5'])
  await ui.unmount()
})

test('a saved session keeps its newest 200 requests, without turn ids, stop reasons or tool names, and says what it dropped', async ($, on) => {
  const { state, store } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  state.stepTools.push(['Bash'])
  for (let i = 0; i < 205; i++) await step($, i)
  await done($)
  const saved = store['session:sess-1'] as { rows: { seq: number }[] }
  expect(saved.rows).toHaveLength(200)
  expect(saved.rows[0]?.seq).toBe(6)
  for (const word of ['turnId', 'stopReason', 'tools', 'Bash']) expect(JSON.stringify(saved)).not.toContain(word)

  state.id = 'sess-2'
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'view:history' })
  await ui.press({ key: 'open:sess-1' })
  expect((await requestSeqs(ui))[0]).toBe('#6')
  expect(await ui.find({ type: 'Text', text: /Showing the newest 200 of 205; older ones were not kept/ })).toBeDefined()
  await ui.unmount()
})

test('a session saved before 0.7.0 opens with its totals and a note in place of its tree and rows', async ($, on) => {
  const { rollup: _, ...legacy } = SOLO
  engine(on, { 'session:aaaa1111': legacy, 'session:bbbb2222': TEAM })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'view:history' })
  await ui.press({ key: 'open:aaaa1111' })
  expect((await ui.find({ type: 'Text', text: /^total / }))?.text).toMatch(/\$1\.000.*4 req/)
  expect(await ui.find({ type: 'Text', text: /No main\/subagent split: saved before session-cost 0\.7\.0/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No request rows: saved before session-cost 0\.7\.0/ })).toBeDefined()

  // One saved with a rollup but no rows (a fork's 0.6.0) has its tree: subagents the main loop spawned hang one level under it.
  await ui.press({ key: 'drill:back' })
  await ui.press({ key: 'open:bbbb2222' })
  expect((await ui.find({ type: 'Text', text: /^main / }))?.text).toMatch(/\$0\.300\s+2 req/)
  expect((await ui.find({ type: 'Button', key: 'agent:agent-p1' }))?.text).toMatch(/^└ Plan .*\$0\.100\s+1 req/)
  expect(await ui.find({ type: 'Text', text: /saved before session-cost 0\.7\.0/ })).toBeDefined()
  await ui.unmount()
})

test('the compare command refuses to set a session against itself', async ($, on) => {
  const { state } = engine(on, { 'session:aaaa1111': SOLO, 'session:bbbb2222': TEAM })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await runCommand($, 'compare aaaa1111 "solo opus run"')).text).toMatch(/both name session aaaa1111; pick two different sessions/)
  expect(state.open).toBe(false)
})

test('a session without breakdowns says so under Totals too, where its wall clock and request time are n/a', async ($, on) => {
  const { rollup: _, ...legacy } = SOLO
  engine(on, { 'session:aaaa1111': legacy, 'session:bbbb2222': TEAM })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await runCommand($, 'compare aaaa bbbb')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Totals, By kind, By model and By subagent each carry the note.
  expect(await ui.findAll({ type: 'Text', text: /^n\/a for A: / })).toHaveLength(4)
  await ui.unmount()
})

test('a subagent\'s details add up: its own line and its subagents make its total', async ($, on) => {
  const { state } = engine(on)
  const { explore, plan } = await nestedSession($)
  state.id = 'sess-2'

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'view:history' })
  await ui.press({ key: 'open:sess-1' })
  await ui.press({ key: `agent:${explore}` })
  // The total counts Explore and the Plan it spawned; Explore's own line and Plan's make it up.
  expect((await ui.find({ type: 'Text', text: /^total / }))?.text).toMatch(/\$0\.0080.*2 req/)
  expect((await ui.find({ type: 'Text', text: /^Explore own / }))?.text).toMatch(/\$0\.0040\s+1 req/)
  expect((await ui.find({ type: 'Button', key: `agent:${plan}` }))?.text).toMatch(/^└ Plan .*\$0\.0040\s+1 req/)
  expect(await requestSeqs(ui)).toEqual(['#2', '#3'])
  await ui.unmount()
})

test('a subagent whose parent the rollup lacks, or whose parents loop, is listed under main, and the lines add up', async ($, on) => {
  const odd = {
    ...TEAM,
    rollup: {
      ...TEAM.rollup,
      byAgent: {
        'agent-orphan': { ...bucket(1, 0.05), type: 'Explore', parentId: 'agent-gone' },
        'agent-loop1': { ...bucket(1, 0.05), type: 'Explore', parentId: 'agent-loop2' },
        'agent-loop2': { ...bucket(1, 0.1), type: 'Plan', parentId: 'agent-loop1' },
      },
    },
  }
  engine(on, { 'session:bbbb2222': odd })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'view:history' })
  await ui.press({ key: 'open:bbbb2222' })
  expect((await ui.find({ type: 'Text', text: /^main / }))?.text).toMatch(/\$0\.300\s+2 req/)
  expect((await ui.find({ type: 'Button', key: 'agent:agent-orphan' }))?.text).toMatch(/^└ Explore /)
  // The loop is broken at one of its agents, which hangs off main with the other under it.
  const loop = [(await ui.find({ type: 'Button', key: 'agent:agent-loop1' }))?.text, (await ui.find({ type: 'Button', key: 'agent:agent-loop2' }))?.text]
  expect(loop.filter(t => /^└ /.test(t ?? ''))).toHaveLength(1)
  expect(loop.filter(t => /^ {2}└ /.test(t ?? ''))).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /^unattributed / })).toBeUndefined()
  await ui.unmount()
})
