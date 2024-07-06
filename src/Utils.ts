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

