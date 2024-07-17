import { noise } from './Perlin';
import { Drawable, Sequential, Point2D } from './Primitive'
import { getRandomBetween, clamp, lerp } from './Utils';

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
    accumTimeMs: number;
    frameId: number;
    render: FrameRequestCallback;

    constructor(initProps: WaveInitProps, drawProps: WaveDrawProps) {
        // Explicit
        this.yPeriod = initProps.yPeriod;
        this.ySin = initProps.ySin;
        this.nPoints = initProps.nPoints;
        this.sequenceNumber = initProps.sequenceNumber;
        this.start = initProps.start;
        this.end = initProps.end;

        this.drawProps = {
            ...drawProps, // NOTE: copy, else all Waves will share same instance
            yMagnitude: clamp(
                drawProps.yMagnitude,
                drawProps.minYMagnitude,
                drawProps.maxYMagnitude
            ),
        };

        // Implicit
        this.tStep = 1 / this.nPoints;
        this.accumTimeMs = 0;
        this.prevTimeMs = -1;
        this.frameId = -1;

        // TODO: Should place in a private init() function
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
            y += this.ylinspace;
        }

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
        this.ySin += elapsed * this.yPeriod;
        this.prevTimeMs = timeMs;
        this.accumTimeMs += elapsed;

        let perlin, yPerlinMagnitude, yPerlin,
            xPerlinMagnitude, xPerlin;

        let y = this.start.y;
        let x = this.start.x;
        let t = 0;

        for (let i = 0; i < this.nPoints; i += 1) {
            perlin = noise(x, y, this.accumTimeMs * 0.001) - 0.5;
            //console.log(perlin)
            yPerlinMagnitude = 32 * 4 * (Math.sin(-Math.PI / 4 + i / this.nPoints * Math.PI) ** 2);
            yPerlin = perlin * yPerlinMagnitude;
            //console.log(this.ys[0]);
            this.ys[i] =
                y
                + yPerlin
                + Math.sin(t * 3 * Math.PI + this.ySin) * this.drawProps.yMagnitude
                + getRandomBetween(-this.drawProps.yJitter, this.drawProps.yJitter);

            xPerlinMagnitude = 32 * 4 * (Math.sin(-Math.PI / 4 + i / this.nPoints * Math.PI) ** 2);
            xPerlin = perlin * xPerlinMagnitude;
            this.xs[i] =
                x
                + xPerlin
                + getRandomBetween(-this.drawProps.xJitter, this.drawProps.xJitter);

            y += this.ylinspace;
            x += this.xlinspace;
            t += this.tStep;
        }
    }

    draw = (ctx: CanvasRenderingContext2D): void => {
        ctx.save()
        ctx.beginPath();
        ctx.strokeStyle = this.drawProps.strokeRgbHex;
        ctx.lineWidth = this.drawProps.lineWidth;

        this.ys.forEach((y, i) => {
            /////////////////////
            // STROKE
            //ctx.strokeStyle = "black";
            ctx.lineTo(
                this.xs[i],
                y
            )

            /////////////////////
            // FILL
            // ctx.fillStyle = "#fff";
            // ctx.arc(x, y, 3, 0, 2*Math.PI);
            // ctx.fill();
        });

        ctx.stroke();
        ctx.restore();
    }

    resize = (scale: Point2D): void => {
        this.start.scale(scale);
        this.end.scale(scale);

        // this.xlinspace = (this.end.x - this.start.x) / this.nPoints;
        // this.ylinspace = (this.end.y - this.start.y) / this.nPoints;
        this.xlinspace *= scale.x;
        this.ylinspace *= scale.y;

        this.xs.forEach((_, i) => {
            this.xs[i] *= scale.x
            //this.ys[i] *= scale.y;
        });
        this.drawProps.yMagnitude = clamp(this.drawProps.yMagnitude * scale.x, this.drawProps.minYMagnitude, this.drawProps.maxYMagnitude);
        //console.log(`scale.x: ${scale.x}, scale.y: ${scale.y}, yMagnitude: ${this.drawProps.yMagnitude}`)

    }

    shutdown = (): void => {
        if (this.frameId === -1) {
            console.error('Calling shutdown() on Wave object but Wave object not in updateAndDraw loop');
            return
        }
        window.cancelAnimationFrame(this.frameId);
        this.frameId = -1;
    }
}


