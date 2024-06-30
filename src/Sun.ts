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
    readonly ctx: CanvasRenderingContext2D;
    readonly origin: Point2D;

    radius: number;
    readonly minRadius: number;
    readonly maxRadius: number;
    readonly fillRgbHex: string;

    // Implicit or set later
    prevTimeMs: number;
    frameId: number;

    constructor(initProps: SunInitProps, drawProps: SunDrawProps) {
        // Explicit
        this.ctx = initProps.ctx;
        this.origin = initProps.origin;

        this.minRadius = drawProps.minRadius;
        this.maxRadius = drawProps.maxRadius;
        this.radius = clamp(drawProps.radius, this.minRadius, this.maxRadius);
        this.fillRgbHex = drawProps.fillRgbHex;

        // Implicit
        this.prevTimeMs = -1;
        this.frameId = -1;
        // `this` will be undefined when re-called
        this.draw = this.draw.bind(this);
        this.updateAndDraw = this.updateAndDraw.bind(this);
        this.shutdown = this.shutdown.bind(this);
    }

    updateAndDraw(timeMs: number) {
        if (this.prevTimeMs === -1) {
            this.prevTimeMs = timeMs;
        }

        const elapsed = timeMs - this.prevTimeMs;

        this.draw(this.fillRgbHex);
        this.prevTimeMs = timeMs;
    }

    draw(
        fillRgbHex: string
    ) {
        this.ctx.beginPath();
        // FILL
        this.ctx.fillStyle = fillRgbHex;
        this.ctx.arc(this.origin.x, this.origin.y, this.radius, 0, 2 * Math.PI);
        this.ctx.fill();
    }

    resize(scale: Point2D) {
        this.origin.scale(scale);
        this.radius = clamp(this.radius * scale.x, this.minRadius, this.maxRadius);
    }

    shutdown() {
        if (this.frameId === -1) {
            console.error('Calling shutdown() on Sun object but Sun object not in updateAndDraw loop');
            return
        }
        window.cancelAnimationFrame(this.frameId);
        this.frameId = -1;
    }
}
