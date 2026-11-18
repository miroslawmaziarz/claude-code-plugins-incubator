import { expect, test } from 'claude-code/testing'

import type { RollupBucket, SessionRollup, SessionSummary } from '../types'
import { byAgentType, cell, compareSessions, delta, resolveSession, span, splitArgs } from './compare'
import type { Metric } from './compare'

/** Rounded to a millionth, so sums of dollar floats compare exactly. */
const near = (x: number | undefined) => Math.round((x ?? Number.NaN) * 1e6) / 1e6

const bucket = (requests: number, usd: number): RollupBucket => ({ input: 100 * requests, output: 10 * requests, cacheRead: 0, cacheWrite: 0, requests, estUsd: usd, ledgerUsd: usd, durationMs: 1000 * requests })
const none = bucket(0, 0)

const rollup = (over: Partial<SessionRollup> = {}): SessionRollup => ({
  firstAt: 0, lastAt: 600_000, durationMs: 4000,
  byKind: { main: bucket(4, 1), subagent: none, compact: none },
  byModel: { 'claude-opus-5-5': bucket(4, 1) },
  byAgent: {},
  ...over,
})

const summary = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  startedAt: 0, lastAt: 600_000, ledgerUsd: 1, estUsd: 1, requests: 4, input: 400, output: 40, cacheRead: 400, cacheWrite: 400, rollup: rollup(), ...over,
})

const metric = (a: number | null, b: number | null, over: Partial<Metric> = {}): Metric => ({ id: 'x', label: 'x', a, b, unit: 'usd', better: 'lower', ...over })

test('a wall-clock span reads in seconds, then minutes and seconds, then hours and minutes', async () => {
  expect(span(45_000)).toBe('45.0s')
  expect(span(600_000)).toBe('10m 00s')
  expect(span(3_720_000)).toBe('1h 02m')
  expect(cell(null, 'usd')).toBe('n/a')
  expect(cell(0.5, 'rate')).toBe('50%')
})

test('B against A: the change, its share of A and whether it is better, by which way the metric is better', async () => {
  expect(delta(metric(1, 0.5))).toEqual({ text: '-$0.500', pct: '-50%', tone: 'better' })
  expect(delta(metric(4, 5, { unit: 'count' }))).toEqual({ text: '+1', pct: '+25%', tone: 'worse' })
  expect(delta(metric(0.33, 0.64, { unit: 'rate', better: 'higher' }))).toEqual({ text: '+31pp', pct: '+94%', tone: 'better' })
  expect(delta(metric(0, 3, { unit: 'count' }))).toEqual({ text: '+3', pct: '—', tone: 'worse' })
  expect(delta(metric(2, 2, { unit: 'count' }))).toEqual({ text: '0', pct: '0%', tone: 'same' })
  expect(delta(metric(null, 2))).toEqual({ text: 'n/a', pct: 'n/a', tone: null })
})

test('subagents are summed by their type', async () => {
  const r = rollup({ byAgent: { e1: { ...bucket(1, 0.1), type: 'Explore' }, e2: { ...bucket(2, 0.2), type: 'Explore' }, p1: { ...bucket(1, 0.5), type: 'Plan' } } })
  const types = byAgentType(r)
  expect(types.Explore?.requests).toBe(3)
  expect(near(types.Explore?.ledgerUsd)).toBe(0.3)
  expect(types.Plan?.requests).toBe(1)
})

test('a side without a rollup is n/a in every section that needs one, Totals included, and each such section says which side', async () => {
  const sections = compareSessions(summary({ rollup: undefined }), summary({ ledgerUsd: 0.5 }))
  expect(sections.map(s => [s.title, s.missing])).toEqual([['Totals', 'A'], ['By kind', 'A'], ['By model', 'A'], ['By subagent', 'A']])
  const totals = sections[0]!.metrics
  expect(totals.find(m => m.id === 'cost')).toMatchObject({ a: 1, b: 0.5 })
  expect(totals.find(m => m.id === 'wall')).toMatchObject({ a: null, b: 600_000 })
  expect(totals.find(m => m.id === 'reqTime')).toMatchObject({ a: null, b: 4000 })
})

test('with both rollups no section is marked missing, and models either side used are listed, the costlier first', async () => {
  const b = summary({ rollup: rollup({ byModel: { 'claude-haiku-5-5': bucket(2, 0.1), 'claude-sonnet-5-5': bucket(2, 2) } }) })
  const sections = compareSessions(summary(), b)
  expect(sections.every(s => s.missing === undefined)).toBe(true)
  const models = sections[2]!.metrics.filter(m => m.id.endsWith(':requests')).map(m => [m.label, m.a, m.b])
  expect(models).toEqual([['sonnet-5-5 req', 0, 2], ['opus-5-5 req', 4, 0], ['haiku-5-5 req', 0, 2]])
})

test('command words split on spaces, a quoted name kept whole', async () => {
  expect(splitArgs(`compare "team sonnet run" 'solo' abc`)).toEqual(['compare', 'team sonnet run', 'solo', 'abc'])
})

test('a session is found by its id, a unique id prefix, its name or a unique part of it, ignoring case', async () => {
  const sessions = [{ id: 'aaaa1111', name: 'Solo opus run' }, { id: 'aaaa2222', name: 'Team run' }, { id: 'bbbb3333' }]
  expect(resolveSession(sessions, 'AAAA1111')).toEqual({ id: 'aaaa1111' })
  expect(resolveSession(sessions, 'bbbb')).toEqual({ id: 'bbbb3333' })
  expect(resolveSession(sessions, 'team run')).toEqual({ id: 'aaaa2222' })
  expect(resolveSession(sessions, 'opus')).toEqual({ id: 'aaaa1111' })
  expect(resolveSession(sessions, 'aaaa')).toEqual({ error: '"aaaa" matches 2 sessions (aaaa1111, aaaa2222); give more of its id' })
  expect(resolveSession(sessions, 'zzz')).toEqual({ error: 'no saved session matches "zzz"' })
  expect(resolveSession(sessions, '  ')).toEqual({ error: 'an empty session name' })
})
