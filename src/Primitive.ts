export interface Drawable {
    frameId: number;

    updateAndDraw(timeMs: number): void;
    resize(scale: Point2D): void;
    shutdown(): void;
}

export interface Sequential {
    readonly sequenceNumber: number;
}

export class Point2D {
    x: number;
    y: number;

    constructor(x: number, y: number) {
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

