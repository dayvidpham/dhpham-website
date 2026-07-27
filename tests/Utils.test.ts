import { afterEach, describe, expect, it, vi } from 'vitest';
import { clamp, getRandomBetween, lerp, rand3DNormed } from '../src/Utils';

describe('math utilities', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each([
        { x0: 10, x1: 20, t: 0, expected: 10 },
        { x0: 10, x1: 20, t: 0.5, expected: 15 },
        { x0: 10, x1: 20, t: 1, expected: 20 },
        { x0: 10, x1: 20, t: 1.5, expected: 25 },
    ])('lerp($x0, $x1, $t) returns $expected', ({ x0, x1, t, expected }) => {
        expect(lerp(x0, x1, t)).toBe(expected);
    });

    it.each([
        { value: -1, min: 0, max: 10, expected: 0 },
        { value: 5, min: 0, max: 10, expected: 5 },
        { value: 11, min: 0, max: 10, expected: 10 },
    ])('clamps $value to $expected', ({ value, min, max, expected }) => {
        expect(clamp(value, min, max)).toBe(expected);
    });

    it('samples between either ordering of the bounds', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.25);

        expect(getRandomBetween(10, 20)).toBe(12.5);
        expect(getRandomBetween(20, 10)).toBe(12.5);
    });

    it('returns a normalized three-dimensional vector', () => {
        const vector = rand3DNormed();
        const magnitude = Math.hypot(...vector);

        expect(vector).toHaveLength(3);
        expect(magnitude).toBeCloseTo(1, 12);
    });
});
