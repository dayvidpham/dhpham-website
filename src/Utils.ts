import { Point2D } from "./Primitive";

export function lerp(x0: number, x1: number, t: number): number {
    return x0 + (x1 - x0) * t
}

export function getRandomBetween(x0: Readonly<number>, x1: Readonly<number>): number {
    if (x0 === x1) {
        return x0;
    }
    const low = Math.min(x0, x1);
    const high = Math.max(x0, x1);
    return Math.random() * (high - low) + low;
}

export function clamp(x: number, min: number, max: number): number {
    return Math.max(min, Math.min(x, max));
}

export function rand2dNorm(): Point2D {
    // Returns a random normalized vector on the unit circle
    const theta = Math.random() * Math.PI;
    const x = Math.cos(theta) ** 2;
    return new Point2D(
        x,
        1 - x, // sin2(x) = 1 - cos2(x)
    )
}

// Return a matrix of 2d gradients
export function initPerlinGrid2d(xN: number, tN: number): number[][] {
    return [[]]
}

export function samplePerlinGrid2d(grid: number[][], x: number, t: number): number {
    return 0
}
