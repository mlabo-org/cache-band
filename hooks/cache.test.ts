import { expect, test } from 'claude-code/testing'

import { parseMonitor, rate, rateColor, short, turnTotals } from './register'

test('reads the monitor JSON, session only when found', () => {
  const out = parseMonitor(
    '{"session":{"cache_read":90,"cache_write":5,"found":true,"input":100,"output":1,"partial":false},"window":{"cache_read":10,"cache_write":0,"input":40,"output":2,"partial":true},"window_minutes":60}',
  )
  expect(out.session).toEqual({ input: 100, cacheRead: 90, cacheWrite: 5, partial: false })
  expect(out.window).toEqual({ input: 40, cacheRead: 10, cacheWrite: 0, partial: true })
  expect(parseMonitor('{"session":{"cache_read":0,"cache_write":0,"found":false,"input":0,"output":0,"partial":false},"window":null,"window_minutes":60}').session).toBeNull()
})

test('a turn counts input as the monitor does', () => {
  const totals = turnTotals({ input_tokens: 2, cache_read_input_tokens: 96, cache_creation_input_tokens: 2, output_tokens: 9, model: 'm' })
  expect(totals.input).toBe(100)
  expect(rate(totals)).toBe(96)
  expect(rate({ input: 0, cacheRead: 0, cacheWrite: 0, partial: false })).toBeNull()
  expect(rateColor(96)).toBe('green')
  expect(rateColor(75)).toBe('yellow')
  expect(rateColor(40)).toBe('red')
  expect(short(2_808_876)).toBe('2.8M')
  expect(short(110_102)).toBe('110k')
})
