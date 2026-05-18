/**
 * @vitest-environment node
 *
 * Contract tests for src/utils/dateUtils.mjs
 * The target module must export: formatRelativeTime, formatShortDate, isToday
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatRelativeTime, formatShortDate, isToday } from './dateUtils.mjs';

describe('formatRelativeTime', () => {
    it('returns "just now" for timestamps within 60 seconds', () => {
        const now = Date.now();
        expect(formatRelativeTime(now - 30_000)).toBe('just now');
        expect(formatRelativeTime(now)).toBe('just now');
    });

    it('returns minutes ago for timestamps 1–59 minutes ago', () => {
        const now = Date.now();
        expect(formatRelativeTime(now - 5 * 60_000)).toBe('5 minutes ago');
        expect(formatRelativeTime(now - 1 * 60_000)).toBe('1 minute ago');
    });

    it('returns hours ago for timestamps 1–23 hours ago', () => {
        const now = Date.now();
        expect(formatRelativeTime(now - 3 * 3600_000)).toBe('3 hours ago');
        expect(formatRelativeTime(now - 1 * 3600_000)).toBe('1 hour ago');
    });

    it('returns days ago for timestamps 1–6 days ago', () => {
        const now = Date.now();
        expect(formatRelativeTime(now - 2 * 86400_000)).toBe('2 days ago');
        expect(formatRelativeTime(now - 1 * 86400_000)).toBe('1 day ago');
    });

    it('returns weeks ago for timestamps 7–29 days ago', () => {
        const now = Date.now();
        expect(formatRelativeTime(now - 14 * 86400_000)).toBe('2 weeks ago');
        expect(formatRelativeTime(now - 7  * 86400_000)).toBe('1 week ago');
    });

    it('returns months ago for timestamps 30–364 days ago', () => {
        const now = Date.now();
        expect(formatRelativeTime(now - 60 * 86400_000)).toBe('2 months ago');
    });

    it('returns years ago for timestamps 365+ days ago', () => {
        const now = Date.now();
        expect(formatRelativeTime(now - 730 * 86400_000)).toBe('2 years ago');
    });

    it('accepts a Date object as well as a timestamp number', () => {
        const d = new Date(Date.now() - 30_000);
        expect(formatRelativeTime(d)).toBe('just now');
    });

    it('throws on invalid input', () => {
        expect(() => formatRelativeTime('not-a-date')).toThrow();
        expect(() => formatRelativeTime(null)).toThrow();
    });
});

describe('formatShortDate', () => {
    it('formats a timestamp to locale-aware short date string', () => {
        const d = new Date('2024-06-15T12:00:00Z');
        const result = formatShortDate(d.getTime());
        // Must contain the year and some representation of month+day.
        expect(result).toMatch(/2024/);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('accepts a Date object', () => {
        const d = new Date('2024-01-01T00:00:00Z');
        expect(typeof formatShortDate(d)).toBe('string');
    });

    it('throws on invalid input', () => {
        expect(() => formatShortDate(NaN)).toThrow();
        expect(() => formatShortDate(undefined)).toThrow();
    });
});

describe('isToday', () => {
    it('returns true for a timestamp from today', () => {
        expect(isToday(Date.now())).toBe(true);
        expect(isToday(new Date())).toBe(true);
    });

    it('returns false for yesterday', () => {
        expect(isToday(Date.now() - 86400_000)).toBe(false);
    });

    it('returns false for tomorrow', () => {
        expect(isToday(Date.now() + 86400_000)).toBe(false);
    });

    it('returns false for a date far in the past', () => {
        expect(isToday(new Date('2000-01-01'))).toBe(false);
    });

    it('throws on invalid input', () => {
        expect(() => isToday('bad')).toThrow();
        expect(() => isToday(null)).toThrow();
    });
});
