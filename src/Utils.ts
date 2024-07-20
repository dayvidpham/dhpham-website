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

export function rand2DNormed(): Point2D {
    // Returns a random normalized vector on the unit circle
    const theta = Math.random() * Math.PI;
    const x = Math.cos(theta) ** 2;
    return new Point2D(
        x,
        1 - x, // sin2(x) = 1 - cos2(x)
    )
}

const HALF_PI = Math.PI / 2;
const TWO_PI = 2 * Math.PI;

export function rand3DNormed(): number[] {
    // From these articles:
    // https://mathworld.wolfram.com/SpherePointPicking.html
    // https://math.stackexchange.com/questions/1585975/how-to-generate-random-points-on-a-sphere
    let azimuthalAngle = TWO_PI * Math.random();
    let polarAngle = Math.acos(2 * Math.random() - 1) - HALF_PI;
    // To [x, y, z]
    return [
        Math.cos(polarAngle) * Math.cos(azimuthalAngle),
        Math.cos(polarAngle) * Math.sin(azimuthalAngle),
        Math.sin(polarAngle),
    ]
}

export const tryQueryDocument = <T extends HTMLElement>(
    query: string,
    constructor: new () => T,
): T => {
    const selectorResult: T | null = document.querySelector(query);
    if (selectorResult === null
        || !(selectorResult instanceof constructor)) {
        throw new ReferenceError(`Could not find ${query} element: something is horribly wrong. Exiting ...`);
    }
    return selectorResult as T;
};

