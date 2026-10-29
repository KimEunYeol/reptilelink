import { describe, expect, it } from 'vitest';
import { growthCoordinates, growthDelta, growthProblem, type GrowthDraft } from '../src/lib/growth';
const row = (measured_on = '2024-02-29', weight_g = '34.25'): GrowthDraft => ({ id: 'one', measured_on, weight_g, note: '' });
describe('growth input and actual dates', () => {
  it('accepts a leap day and exact decimal boundaries', () => { expect(growthProblem([row()], '2024-03-01', '')).toBe(''); expect(growthProblem([row('2024-03-01', '100000')], '2024-03-01', '')).toBe(''); });
  it('rejects invalid calendar dates and future days', () => { for (const day of ['2023-02-29', '2024-02-30', '0000-01-01', '2024-03-02']) expect(growthProblem([row(day)], '2024-03-01', '')).not.toBe(''); });
  it('rejects zero, excess precision, exponent, and overflow', () => { for (const weight of ['0', '-1', '34.251', '100000.01', '1e2', 'NaN']) expect(growthProblem([row('2024-02-29', weight)], '2024-03-01', '')).not.toBe(''); });
  it('rejects duplicate days and counts private note Unicode codepoints', () => { expect(growthProblem([row(), { ...row(), id: 'two' }], '2024-03-01', '')).not.toBe(''); expect(growthProblem([row()], '2024-03-01', '🦎'.repeat(2000))).toBe(''); expect(growthProblem([{ ...row(), note: '🦎'.repeat(1001) }], '2024-03-01', '')).not.toBe(''); });
  it('sends only changed rows while retaining a new row identity', () => { const old = row(), added = { ...row('2024-03-01'), id: 'two' }; expect(growthDelta([old, added], [old])).toEqual([added]); expect(growthDelta([{ ...old, weight_g: '35' }], [old])).toHaveLength(1); });
  it('positions sparse observations by actual elapsed dates without filling gaps', () => { const chart = growthCoordinates([{ measured_on: '2024-02-01', weight_g: 20 }, { measured_on: '2024-02-11', weight_g: 21 }, { measured_on: '2024-02-29', weight_g: 34 }], '2024-02-01', '2024-02-29'); expect(chart.points).toHaveLength(3); expect(chart.points[0].x).toBe(45); expect(chart.points[2].x).toBe(280); expect(chart.points[1].x).toBeCloseTo(45 + 235 * 10 / 28); expect(chart.points.every(p => Number.isFinite(p.y))).toBe(true); });
});
