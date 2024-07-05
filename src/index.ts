// import Wave from './Wave';
// maybe fuck the import: all in one file
// easier to keep track of

function lerp(x0: number, x1: number, t: number) {
    return x0 + (x1 - x0) * t
}

function getRandomBetween(x0: number, x1: number): number {
    if (x0 === x1) {
        return x0;
    }
    const low = Math.min(x0, x1);
    const high = Math.max(x0, x1);
    return Math.random() * (high - low) + low;
}

interface Drawable {
    frameId: number;

    updateAndDraw(timeMs: number): void;
    resize(scale: Point2DProps): void;
    shutdown(): void;
}

interface Sequential {
    readonly sequenceNumber: number;
}

type Point2DProps = {
    x: number;
    y: number;
}
class Point2D {
    x: number;
    y: number;

    constructor({ x, y }: Point2DProps) {
        this.x = x;
        this.y = y;
    }

    scale(factor: Point2D) {
        this.x *= factor.x;
        this.y *= factor.y;
    }
}





////////////////////////////////////////////////////
// Wave
////////////////////////////////////////////////////

type WaveInitProps = {
    readonly ctx: CanvasRenderingContext2D;
    readonly start: Point2D;
    readonly end: Point2D;
    readonly ySin: number;
    readonly yPeriod: number;
    readonly nPoints: number;
    readonly sequenceNumber: number;
}

type WaveDrawProps = {
    yMagnitude: number,
    readonly xJitter: number,
    readonly yJitter: number,
    readonly strokeRgbHex: string,
    readonly lineWidth: number,
}

class Wave implements Drawable, Sequential {
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

        this.drawProps = drawProps;

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

    updateAndDraw(timeMs: number) {
        if (this.prevTimeMs === -1) {
            this.prevTimeMs = timeMs;
        }

        // NOTE: Update step
        const elapsed = timeMs - this.prevTimeMs;
        this.ySin += elapsed * this.yPeriod;
        this.prevTimeMs = timeMs;

        // NOTE: Draw step
        this.draw(this.ySin, this.drawProps);
    }

    draw(
        ySin: number,
        drawProps: WaveDrawProps
    ) {
        this.ctx.beginPath();
        this.ctx.strokeStyle = drawProps.strokeRgbHex;
        this.ctx.lineWidth = drawProps.lineWidth;

        let y = this.start.y,
            t = 0;
        for (let i = 0; i < this.nPoints; i += 1) {
            this.ys[i] = y
                + Math.sin(t * 3 * Math.PI + ySin) * drawProps.yMagnitude
                + getRandomBetween(-drawProps.yJitter, drawProps.yJitter);

            y += this.ylinspace;
            t += this.tStep;
        }

        this.ys.forEach((val, i) => {
            /////////////////////
            // STROKE
            //this.ctx.strokeStyle = "black";
            this.ctx.lineTo(
                this.xs[i] + getRandomBetween(-drawProps.xJitter, drawProps.xJitter),
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
        console.log(scale);

        // this.xlinspace = (this.end.x - this.start.x) / this.nPoints;
        // this.ylinspace = (this.end.y - this.start.y) / this.nPoints;
        this.xlinspace *= scale.x;
        this.ylinspace *= scale.y;

        this.xs.forEach((_, i) => this.xs[i] *= scale.x);
        this.drawProps.yMagnitude *= scale.y;

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





////////////////////////////////////////////////////
// Sun
////////////////////////////////////////////////////

type SunProps = {
    ctx: CanvasRenderingContext2D;
    origin: Point2D;
    radius: number;
    fillRgbHex: string;
}

class Sun implements Drawable {
    // Explicit
    readonly ctx: CanvasRenderingContext2D;
    readonly origin: Point2D;
    radius: number;
    readonly fillRgbHex: string;
    // Implicit or set later
    prevTimeMs: number;
    frameId: number;

    constructor(props: SunProps) {
        // Explicit
        this.ctx = props.ctx;
        this.origin = props.origin;
        this.radius = props.radius;
        this.fillRgbHex = props.fillRgbHex;
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
        this.radius *= scale.x;
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
////////////////////////////////////////////////////





////////////////////////////////////////////////////
// CanvasController
////////////////////////////////////////////////////

type CanvasControllerDrawables = {
    simples: Drawable[],
    sequentials: Record<string, (Sequential & Drawable)[]>,
};

class CanvasController {
    readonly ctx: CanvasRenderingContext2D;
    readonly fps: number;
    drawables: CanvasControllerDrawables;

    loopId: number;
    readonly fpMs: number;
    dims: {
        width: number,
        height: number,
    }

    constructor(
        ctx: CanvasRenderingContext2D,
        fps: number,
        drawables: CanvasControllerDrawables,
    ) {
        // Explicit
        this.ctx = ctx;
        this.fps = fps;
        this.drawables = drawables;
        // Implicit
        this.loopId = -1;
        this.fpMs = 1 / fps * 1000;
        this.dims = {
            width: window.innerWidth,
            height: window.innerHeight
        };
        // Bindings
        this.init = this.init.bind(this);
        this.shutdown = this.shutdown.bind(this);
    }

    init() {
        if (this.loopId != -1) {
            console.error('Called loop() in CanvasController instance when already looping. Returning.');
            return
        }

        window.addEventListener('resize', fHandleResize(this, this.ctx.canvas));
        const loop = () => {
            this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);

            for (let i = 0; i < this.drawables.simples.length; i++) {
                this.drawables.simples[i].frameId = window.requestAnimationFrame(this.drawables.simples[i].updateAndDraw);
            }

            for (let seq_type in this.drawables.sequentials) {
                let seqs = this.drawables.sequentials[seq_type]
                for (let i = 0; i < seqs.length; i++) {
                    seqs[i].frameId = window.requestAnimationFrame(seqs[i].updateAndDraw);
                }
            }
        };

        this.loopId = setInterval(loop, this.fpMs);

    }

    resize() {
        let scaleFactorX = window.innerWidth / this.dims.width;
        let scaleFactorY = window.innerHeight / this.dims.height;
        let scale = new Point2D({ x: scaleFactorX, y: scaleFactorY });

        this.dims.width = window.innerWidth;
        this.dims.height = window.innerHeight;

        for (let i = 0; i < this.drawables.simples.length; i++) {
            this.drawables.simples[i].resize(scale);
        }

        for (let seq_type in this.drawables.sequentials) {
            let seqs = this.drawables.sequentials[seq_type]
            for (let i = 0; i < seqs.length; i++) {
                seqs[i].resize(scale)
            }
        }
    }

    shutdown() {
        if (this.loopId === -1) {
            console.error('Called shutdown() in CanvasController instance when not yet looping. Returning.');
            return
        }
        clearInterval(this.loopId);
        this.loopId = -1;

        for (let i = 0; i < this.drawables.simples.length; i++) {
            this.drawables.simples[i].shutdown();
        }

        for (let seq_type in this.drawables.sequentials) {
            let seqs = this.drawables.sequentials[seq_type]
            for (let i = 0; i < seqs.length; i++) {
                seqs[i].shutdown();
            }
        }
    }
}

function fHandleResize(controller: CanvasController, canvas: HTMLCanvasElement) {
    return function () {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        controller.resize();
    };
};
////////////////////////////////////////////////////





////////////////////////////////////////////////////
// Init canvas
////////////////////////////////////////////////////
const canvasQuery: HTMLCanvasElement | null = document.querySelector("#main-canvas");
if (canvasQuery === null) {
    throw new ReferenceError('Could not find #main-canvas element: something is horribly wrong. Exiting ...');
}
const canvas: HTMLCanvasElement = canvasQuery;
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const ctx = canvas.getContext("2d");
if (ctx === null) {
    throw new ReferenceError('Canvas failed to return 2d context');
}

const sun = new Sun({
    ctx: ctx,
    origin: new Point2D({ x: ctx.canvas.width / 3, y: ctx.canvas.height / 2 }),
    radius: Math.min(ctx.canvas.width / 7, 150),
    fillRgbHex: '#b8360f',
});
// console.log(`radius ${Math.min(ctx.canvas.width / 7, 150)}`);

const NUM_WAVES = 6;
const yOffset = ctx.canvas.height / (2 * NUM_WAVES);
const ySinOffset = Math.PI / NUM_WAVES
const drawables: CanvasControllerDrawables = {
    simples: [sun],
    sequentials: {
        waves: [],
    }
}


const waveDrawProps = {
    yMagnitude: 200,
    strokeRgbHex: '#a0a0cc95',
    xJitter: 0,
    yJitter: 0,
    lineWidth: 0.75,
}

for (let i = 0; i < NUM_WAVES; i++) {
    drawables.sequentials.waves.push(new Wave({
        // NOTE: WaveInitProps
        ctx: ctx,
        start: new Point2D({
            x: -10,
            y: ctx.canvas.height / 2 - yOffset * NUM_WAVES + yOffset * i * 2
        }),
        end: new Point2D({
            x: ctx.canvas.width + 10,
            y: ctx.canvas.height / 2 + yOffset * NUM_WAVES - yOffset * i
        }),
        nPoints: 16,
        yPeriod: 2 * Math.PI / 3000, // NOTE: 1 period per 3000ms
        ySin: ySinOffset * i,
        sequenceNumber: i,
    }, waveDrawProps));
}

const fps = 60;
const controller = new CanvasController(ctx, fps, drawables);
controller.init();

//setTimeout(controller.shutdown, 5 * 1000);
//controller.shutdown();

