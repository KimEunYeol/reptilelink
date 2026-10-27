import { describe, expect, it } from 'vitest';
import { animalSchema, profileSchema, userMessage } from '../src/lib/domain';
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
describe('untrusted uploaded image headers', () => {
  it('rejects arbitrary bytes disguised as WebP', () => {
    expect(() => inspectWebp(new TextEncoder().encode('<svg onload="alert(1)">'))).toThrow('INVALID_IMAGE');
  });
  it('rejects truncated RIFF files', () => {
    const bytes = new Uint8Array(30); bytes.set(new TextEncoder().encode('RIFF')); bytes.set(new TextEncoder().encode('WEBP'), 8);
    expect(() => inspectWebp(bytes)).toThrow('INVALID_IMAGE');
  });
});
