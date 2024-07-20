export interface Drawable {
    frameId: number;
    render: FrameRequestCallback;

    fRender(ctx: CanvasRenderingContext2D): FrameRequestCallback;
    update(timeMs: number): void;
    resize(scale: Point2D): void;
    draw(ctx: CanvasRenderingContext2D): void;
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

    scale = (factor: Point2D): void => {
        this.x *= factor.x;
        this.y *= factor.y;
    }

    magnitude = (): number => {
        return Math.sqrt(this.x ** 2 + this.y ** 2)
    }

    isZero = (): boolean => {
        return this.x == 0 && this.y == 0;
    }
}

export type ViewModel = Map<string, any>;

