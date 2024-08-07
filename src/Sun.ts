import { Drawable, Point2D } from './Primitive'
import { clamp } from './Utils'

export type SunInitProps = {
    readonly ctx: CanvasRenderingContext2D;
    origin: Point2D;
}

export type SunDrawProps = {
    radius: number;
    minRadius: number;
    maxRadius: number;
    readonly fillRgbHex: string;
}

export class Sun implements Drawable {
    // Explicit
    readonly origin: Point2D;

    radius: number;
    readonly minRadius: number;
    readonly maxRadius: number;
    readonly fillRgbHex: string;

    // Implicit or set later
    render: FrameRequestCallback;
    prevTimeMs: number;
    frameId: number;

    constructor(initProps: SunInitProps, drawProps: SunDrawProps) {
        // Explicit
        this.origin = initProps.origin;

        this.minRadius = drawProps.minRadius;
        this.maxRadius = drawProps.maxRadius;
        this.radius = clamp(drawProps.radius, this.minRadius, this.maxRadius);
        this.fillRgbHex = drawProps.fillRgbHex;

        // Implicit
        this.prevTimeMs = -1;
        this.frameId = -1;
        this.render = this.fRender(initProps.ctx);
    }

    fRender = (ctx: CanvasRenderingContext2D): FrameRequestCallback => {
        const render = (timeMs: number) => {
            this.update(timeMs);
            this.draw(ctx);
        }
        return render;
    }

    update = (timeMs: number): void => {
        if (this.prevTimeMs === -1) {
            this.prevTimeMs = timeMs;
        }

        const elapsed = timeMs - this.prevTimeMs;
        this.prevTimeMs = timeMs;
    }

    draw = (ctx: CanvasRenderingContext2D): void => {
        ctx.beginPath();
        // FILL
        ctx.fillStyle = this.fillRgbHex;
        ctx.arc(this.origin.x, this.origin.y, this.radius, 0, 2 * Math.PI);
        ctx.fill();
    }

    resize = (scale: Point2D): void => {
        this.origin.scale(scale);
        this.radius = clamp(this.radius * scale.x, this.minRadius, this.maxRadius);
    }

    shutdown = (): void => {
        if (this.frameId === -1) {
            console.error('Calling shutdown() on Sun object but Sun object not in updateAndDraw loop');
            return
        }
        window.cancelAnimationFrame(this.frameId);
        this.frameId = -1;
    }
}
