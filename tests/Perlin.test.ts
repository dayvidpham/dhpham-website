import { describe, expect, it } from 'vitest';
import { noise } from '../src/Perlin';

describe('Perlin noise invariants', () => {
    it.each([
        [0, 0, 0],
        [1, 2, 3],
        [-1, -2, -3],
        [256, 512, 768],
    ])('is zero at integer lattice point (%s, %s, %s)', (x, y, z) => {
        expect(Math.abs(noise(x, y, z))).toBe(0);
    });

    it.each([
        [256, 0, 0],
        [0, 256, 0],
        [0, 0, 256],
    ])('repeats across the 256-cell grid period', (dx, dy, dz) => {
        const point = [12.25, -7.5, 0.125] as const;

        expect(noise(point[0] + dx, point[1] + dy, point[2] + dz))
            .toBeCloseTo(noise(...point), 5);
    });

    it('returns a finite value for a representative non-lattice point', () => {
        expect(noise(0.125, 10.5, -42.75)).toBeTypeOf('number');
        expect(Number.isFinite(noise(0.125, 10.5, -42.75))).toBe(true);
    });
});
