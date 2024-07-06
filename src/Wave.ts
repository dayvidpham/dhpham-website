import { Drawable, Sequential, Point2D } from './Primitive'
import { getRandomBetween, clamp } from './Utils';

export type WaveInitProps = {
    readonly ctx: CanvasRenderingContext2D;
    readonly start: Point2D;
    readonly end: Point2D;
    readonly ySin: number;
    readonly yPeriod: number;
    readonly nPoints: number;

    readonly sequenceNumber: number;
}

export type WaveDrawProps = {
    yMagnitude: number,
    minYMagnitude: number,
    maxYMagnitude: number,
    readonly xJitter: number,
    readonly yJitter: number,
    readonly strokeRgbHex: string,
    readonly lineWidth: number,
}

export class Wave implements Drawable, Sequential {
    // Explicit
    readonly ctx: CanvasRenderingContext2D;
    start: Point2D;
    end: Point2D;
    readonly yPeriod: number;
    ySin: number;
    readonly nPoints: number;

    // Sequential
    readonly sequenceNumber: number;

    // Draw fn
    drawProps: WaveDrawProps;
    xs: Float32Array;
    ys: Float32Array;

    // Implicit or set later
    xlinspace: number;
    ylinspace: number;
    readonly tStep: number;
    prevTimeMs: number;
    frameId: number;
    readonly scaleRatio: {
        start: Point2D
        end: Point2D
    }

    constructor(initProps: WaveInitProps, drawProps: WaveDrawProps) {
        // Explicit
        this.ctx = initProps.ctx;
        this.yPeriod = initProps.yPeriod;
        this.ySin = initProps.ySin;
        this.nPoints = initProps.nPoints;
        this.sequenceNumber = initProps.sequenceNumber;
        this.start = initProps.start;
        this.end = initProps.end;

        this.drawProps = { ...drawProps }; // NOTE: copy, else all Waves will share same instance

        // Implicit
        this.tStep = 1 / this.nPoints;
        this.prevTimeMs = -1;
        this.frameId = -1;

        this.scaleRatio = {
            start: new Point2D({
                x: this.start.x / this.ctx.canvas.width,
                y: this.start.y / this.ctx.canvas.height
            }),
            end: new Point2D({
                x: this.end.x / this.ctx.canvas.width,
                y: this.end.y / this.ctx.canvas.height
            }),
        }

        // NOTE: Init TypedArrays
        this.xlinspace = (this.end.x - this.start.x) / ((initProps.nPoints - 1) || 1);
        this.ylinspace = (this.end.y - this.start.y) / ((initProps.nPoints - 1) || 1);
        this.xs = new Float32Array(this.nPoints);   // optimize calcs
        this.ys = new Float32Array(this.nPoints);
        let x = this.start.x,
            y = this.start.y,
            t = 0;

        for (let i = 0; i < this.nPoints; i += 1) {
            this.xs[i] = x
                + getRandomBetween(-drawProps.xJitter, drawProps.xJitter);

            x += this.xlinspace;
        }

        // `this` will be undefined when re-called
        this.updateAndDraw = this.updateAndDraw.bind(this);
        this.draw = this.draw.bind(this);
        this.resize = this.resize.bind(this);
        this.shutdown = this.shutdown.bind(this);
    }

    updateAndDraw(timeMs: number): void {
        if (this.prevTimeMs === -1) {
            this.prevTimeMs = timeMs;
        }

        // NOTE: Update step
        const elapsed = timeMs - this.prevTimeMs;
        this.ySin += elapsed * this.yPeriod;
        this.prevTimeMs = timeMs;

        // NOTE: Draw step
        this.draw();
    }

    draw() {
        this.ctx.beginPath();
        this.ctx.strokeStyle = this.drawProps.strokeRgbHex;
        this.ctx.lineWidth = this.drawProps.lineWidth;

        let y = this.start.y;
        let t = 0;
        for (let i = 0; i < this.nPoints; i += 1) {
            this.ys[i] = y
                + Math.sin(t * 3 * Math.PI + this.ySin) * this.drawProps.yMagnitude
                + getRandomBetween(-this.drawProps.yJitter, this.drawProps.yJitter);

            y += this.ylinspace;
            t += this.tStep;
        }

        this.ys.forEach((val, i) => {
            /////////////////////
            // STROKE
            //this.ctx.strokeStyle = "black";
            this.ctx.lineTo(
                this.xs[i] + getRandomBetween(-this.drawProps.xJitter, this.drawProps.xJitter),
                val
            )

            /////////////////////
            // FILL
            // this.ctx.fillStyle = "#fff";
            // this.ctx.arc(x, y, 3, 0, 2*Math.PI);
            // this.ctx.fill();
        });

        this.ctx.stroke();
    }

    resize(scale: Point2D) {
        this.start.scale(scale);
        this.end.scale(scale);

        // this.xlinspace = (this.end.x - this.start.x) / this.nPoints;
        // this.ylinspace = (this.end.y - this.start.y) / this.nPoints;
        this.xlinspace *= scale.x;
        this.ylinspace *= scale.y;

        this.xs.forEach((_, i) => this.xs[i] *= scale.x);
        this.drawProps.yMagnitude = clamp(this.drawProps.yMagnitude * scale.x, this.drawProps.minYMagnitude, this.drawProps.maxYMagnitude);
        console.log(`scale.x: ${scale.x}, scale.y: ${scale.y}, yMagnitude: ${this.drawProps.yMagnitude}`)

    }

    shutdown() {
        if (this.frameId === -1) {
            console.error('Calling shutdown() on Wave object but Wave object not in updateAndDraw loop');
            return
        }
        window.cancelAnimationFrame(this.frameId);
        this.frameId = -1;
    }
}


