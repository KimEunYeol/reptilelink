export type GrowthPoint = { measured_on: string; weight_g: number };
export type GrowthPeriod = 'week' | 'month' | 'year';
export type GrowthRecord = GrowthPoint & { id: string; note: string };
export type GrowthDraft = Omit<GrowthRecord, 'weight_g'> & { weight_g: string };
export type GrowthView = { today: string; period: GrowthPeriod; from: string; to: string; records: GrowthPoint[]; chart: GrowthPoint[]; next_before: string | null; latest: GrowthPoint | null };
export type OwnerGrowth = Omit<GrowthView, 'records'> & { records: GrowthRecord[]; note: string; show_growth: boolean; revision: number; total: number; profile_total: number };
export const growthPeriods: [GrowthPeriod, string][] = [['week', '주간'], ['month', '월간'], ['year', '년간']];
export const growthDraft = (row: GrowthRecord): GrowthDraft => ({ ...row, weight_g: String(row.weight_g) });
export function growthProblem(rows: GrowthDraft[], today: string, note: string): string {
  if ([...note].length > 2000) return '개체 메모는 2,000자 이내로 입력해주세요.';
  const dates = new Set<string>();
  for (const r of rows) {
    const d = new Date(`${r.measured_on}T00:00:00Z`);
    if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(r.measured_on) || Number.isNaN(d.valueOf()) || d.toISOString().slice(0, 10) !== r.measured_on || r.measured_on > today) return '기록일은 오늘까지의 올바른 날짜로 입력해주세요.';
    if (dates.has(r.measured_on)) return '같은 날짜에는 기록을 하나만 저장할 수 있습니다.';
    dates.add(r.measured_on);
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(r.weight_g) || Number(r.weight_g) <= 0 || Number(r.weight_g) > 100000) return '체중은 0보다 크고 100,000g 이하, 소수 둘째 자리까지 입력해주세요.';
    if ([...r.note].length > 1000) return '기록 메모는 1,000자 이내로 입력해주세요.';
  }
  return '';
}
export function growthDelta(rows: GrowthDraft[], baseline: GrowthDraft[]) {
  const old = new Map(baseline.map(r => [r.id, r]));
  return rows.filter(r => JSON.stringify(r) !== JSON.stringify(old.get(r.id))).map(({ id, measured_on, weight_g, note }) => ({ id, measured_on, weight_g, note }));
}
export function growthCoordinates(points: GrowthPoint[], from: string, to: string) {
  const weights = points.map(p => p.weight_g), low = Math.max(0, Math.min(...weights) * .9), high = Math.max(...weights, 1) * 1.1;
  const start = Date.parse(from), duration = Math.max(Date.parse(to) - start, 86400000);
  return { low, high, points: points.map(p => ({ ...p, x: 45 + (Date.parse(p.measured_on) - start) / duration * 235, y: 150 - (p.weight_g - low) / (high - low) * 125 })) };
}
