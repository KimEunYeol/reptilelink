import { describe, expect, it } from 'vitest';
import { animalEditSchema, animalSchema, profileSchema, seoulDate, userMessage } from '../src/lib/domain';
import { inspectWebp } from '../worker/images';

describe('user input boundaries', () => {
  it('normalizes profile addresses while rejecting invalid length and delimiters', () => {
    expect(profileSchema.parse({ slug: ' Green-Room ', name: ' 초록빛 ', bio: '' }).slug).toBe('green-room');
    for (const slug of ['a', '-room', 'room-', '한글주소', 'room/name', 'x'.repeat(31)]) expect(profileSchema.safeParse({ slug, name: '이름', bio: '' }).success).toBe(false);
  });
  it('rejects whitespace-only animal names and unexpected enum values', () => {
    const valid = { name: '도리', species: '크레스티드 게코', morph: '', sex: 'male', description: '', listing_status: 'not_listed', is_public: true };
    expect(animalSchema.safeParse(valid).success).toBe(true);
    expect(animalSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
    expect(animalSchema.safeParse({ ...valid, sex: 'admin' }).success).toBe(false);
  });
  it('does not disclose SQL errors in user-facing messages', () => {
    expect(userMessage(new Error('permission denied for private.account_state'))).not.toContain('private');
    expect(userMessage(new Error('VERSION_CONFLICT'))).toContain('다른 화면');
  });
});
describe('animal edit boundaries', () => {
  const valid = { name: '도리', species: '게코', morph: '', sex: 'unknown', birth_date: null, description: '', listing_status: 'not_listed' };
  it('accepts clearing a birthday and valid leap dates, rejects invalid and future dates', () => {
    expect(animalEditSchema.parse(valid).birth_date).toBeNull();
    expect(animalEditSchema.safeParse({ ...valid, birth_date: '2024-02-29' }).success).toBe(true);
    for (const birth_date of ['2023-02-29', '2024-02-30', '0000-01-01', '', '2999-01-01']) expect(animalEditSchema.safeParse({ ...valid, birth_date }).success).toBe(false);
  });
  it('uses the Korean day boundary rather than the browser timezone', () => {
    expect(seoulDate(new Date('2026-10-28T14:59:59Z'))).toBe('2026-10-28');
    expect(seoulDate(new Date('2026-10-28T15:00:00Z'))).toBe('2026-10-29');
  });
  it('counts Unicode code points and rejects forbidden or missing fields', () => {
    expect(animalEditSchema.safeParse({ ...valid, name: '🦎'.repeat(40) }).success).toBe(true);
    expect(animalEditSchema.safeParse({ ...valid, name: '🦎'.repeat(41) }).success).toBe(false);
    expect(animalEditSchema.safeParse({ ...valid, name: '\t\n' }).success).toBe(false);
    expect(animalEditSchema.safeParse({ ...valid, name: '\uFEFF' }).success).toBe(false);
    expect(animalEditSchema.parse({ ...valid, name: '\uFEFF도리\uFEFF' }).name).toBe('도리');
    for (const field of ['is_public', 'profile_id', 'photos', 'show_growth', 'sort_order']) expect(animalEditSchema.safeParse({ ...valid, [field]: true }).success).toBe(false);
    expect(animalEditSchema.safeParse({ ...valid, name: undefined }).success).toBe(false);
  });
});
describe('untrusted uploaded image headers', () => {
  it('rejects arbitrary bytes disguised as WebP', () => {
    expect(() => inspectWebp(new TextEncoder().encode('<svg onload="alert(1)">'))).toThrow('INVALID_IMAGE');
  });
  it('rejects truncated RIFF files', () => {
    const bytes = new Uint8Array(30); bytes.set(new TextEncoder().encode('RIFF')); bytes.set(new TextEncoder().encode('WEBP'), 8);
    expect(() => inspectWebp(bytes)).toThrow('INVALID_IMAGE');
  });
});
