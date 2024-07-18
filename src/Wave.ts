import { noise } from './Perlin';
import { Drawable, Sequential, Point2D } from './Primitive'
import { getRandomBetween, clamp, lerp } from './Utils';

export type WaveInitProps = {
    readonly ctx: CanvasRenderingContext2D;
    readonly start: Point2D;
    readonly end: Point2D;
    readonly ySin: number;
    readonly ySinPeriodMs: number;
    readonly numPoints: number;

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
    readonly ySinPeriodMs: number;
    ySin: number;
    readonly numPoints: number;

    // Sequential
    readonly sequenceNumber: number;

    // Draw fn
    drawProps: WaveDrawProps;
    xs: Float32Array;
    ys: Float32Array;

    // Implicit or set later
    xlinspace: number;
    ylinspace: number;
    readonly tAnchorLinspace: number;
    prevTimeMs: number;
    accumTimeMs: number;
    frameId: number;
    render: FrameRequestCallback;

    constructor(initProps: WaveInitProps, drawProps: WaveDrawProps) {
        // Explicit
        this.ySinPeriodMs = initProps.ySinPeriodMs;
        this.ySin = initProps.ySin;
        this.numPoints = initProps.numPoints;
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
        this.tAnchorLinspace = 1 / this.numPoints;
        this.accumTimeMs = 0;
        this.prevTimeMs = -1;
        this.frameId = -1;

        // TODO: Should place in a private init() function
        // NOTE: Init TypedArrays
        this.xlinspace = (this.end.x - this.start.x) / ((initProps.numPoints - 1) || 1);
        this.ylinspace = (this.end.y - this.start.y) / ((initProps.numPoints - 1) || 1);
        this.xs = new Float32Array(this.numPoints);   // optimize calcs
        this.ys = new Float32Array(this.numPoints);
        let x = this.start.x,
            y = this.start.y,
            t = 0;

        for (let i = 0; i < this.numPoints; i += 1) {
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

        const elapsedMs = timeMs - this.prevTimeMs;
        this.ySin += elapsedMs * this.ySinPeriodMs;
        this.prevTimeMs = timeMs;
        this.accumTimeMs += elapsedMs;

        let yPerlinSample, yPerlinMagnitude, yPerlinWeight, yPerlin,
            xPerlinSample, xPerlinMagnitude, xPerlinWeight, xPerlin;

        let y = this.start.y;
        let x = this.start.x;
        let tAnchor = 0;
        let perlinStep = this.accumTimeMs * 0.001;
        let perlinWeight = 0; // TODO: possibly pre-computed

        for (let i = 0; i < this.numPoints; i += 1) {
            yPerlinSample = noise(x, y + perlinStep, perlinStep);
            // console.log(perlin)

            yPerlinWeight = (Math.sin(-Math.PI / 4 + tAnchor * 1.25 * Math.PI) ** 4);
            //yPerlinWeight *= yPerlinWeight;
            //i == (32) ? console.log(yPerlinWeight) : null;
            yPerlinMagnitude = 2 * 16 * yPerlinWeight;
            yPerlin = yPerlinSample * yPerlinMagnitude;
            // i == 0 ? console.log(yPerlin) : null;

            this.ys[i] =
                y
                + yPerlin
                + Math.sin(tAnchor * 3 * Math.PI + this.ySin) * this.drawProps.yMagnitude
                // + Math.sin(t * Math.PI + this.ySin) * this.drawProps.yMagnitude
                + getRandomBetween(-this.drawProps.yJitter, this.drawProps.yJitter);

            xPerlinSample = noise(x + perlinStep, y, perlinStep);
            xPerlinWeight = yPerlinWeight;
            xPerlinMagnitude = 1 * 16 * xPerlinWeight;
            xPerlin = xPerlinSample * xPerlinMagnitude;
            this.xs[i] =
                x
                + xPerlin
                + getRandomBetween(-this.drawProps.xJitter, this.drawProps.xJitter);

            y += this.ylinspace;
            x += this.xlinspace;
            tAnchor += this.tAnchorLinspace;
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


