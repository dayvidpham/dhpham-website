export interface Drawable {
    frameId: number;

    updateAndDraw(timeMs: number): void;
    resize(scale: Point2DProps): void;
    shutdown(): void;
}

export interface Sequential {
    readonly sequenceNumber: number;
}

export type Point2DProps = {
    x: number;
    y: number;
}
export class Point2D {
    x: number;
    y: number;

    constructor({ x, y }: Point2DProps) {
        this.x = x;
        this.y = y;
    }

    scale(factor: Point2D): void {
        this.x *= factor.x;
        this.y *= factor.y;
    }

    magnitude(): number {
        return Math.sqrt(this.x ** 2 + this.y ** 2)
    }
}

