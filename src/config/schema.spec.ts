import { describe, it, expect } from 'vitest';
import { timeSchema, dateSchema, repeatSchema } from './schema';

describe('timeSchema', () => {
  it('приймає валідні HH:mm', () => {
    expect(timeSchema.safeParse('08:00').success).toBe(true);
    expect(timeSchema.safeParse('23:59').success).toBe(true);
    expect(timeSchema.safeParse('00:00').success).toBe(true);
  });

  it('відхиляє невалідні формати', () => {
    expect(timeSchema.safeParse('8:00').success).toBe(false);
    expect(timeSchema.safeParse('24:00').success).toBe(false);
    expect(timeSchema.safeParse('12:60').success).toBe(false);
    expect(timeSchema.safeParse('foo').success).toBe(false);
  });
});

describe('dateSchema', () => {
  it('приймає валідні YYYY-MM-DD', () => {
    expect(dateSchema.safeParse('2026-06-26').success).toBe(true);
    expect(dateSchema.safeParse('2000-01-01').success).toBe(true);
  });

  it('відхиляє невалідні', () => {
    expect(dateSchema.safeParse('26-06-2026').success).toBe(false);
    expect(dateSchema.safeParse('2026/06/26').success).toBe(false);
    expect(dateSchema.safeParse('foo').success).toBe(false);
  });
});

describe('repeatSchema', () => {
  it('приймає валідну конфігурацію повторів', () => {
    expect(repeatSchema.safeParse({ intervalMin: 15, maxRetries: 3 }).success).toBe(true);
  });

  it('відхиляє відʼємний intervalMin', () => {
    expect(repeatSchema.safeParse({ intervalMin: -1, maxRetries: 3 }).success).toBe(false);
  });

  it('відхиляє занадто великий intervalMin', () => {
    expect(repeatSchema.safeParse({ intervalMin: 999, maxRetries: 3 }).success).toBe(false);
  });
});
