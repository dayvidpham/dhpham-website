import { Wave } from './Wave';
import { Sun } from './Sun';
import { Drawable, Sequential, Point2D } from './Primitive';
// maybe fuck the import: all in one file
// easier to keep track of


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

    init(): void {
        if (this.loopId != -1) {
            console.error('Called loop() in CanvasController instance when already looping. Returning.');
            return
        }

        window.addEventListener('resize', fDebouncer(fHandleResize(this, this.ctx.canvas), 200));

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

    resize(): void {
        let scaleFactorX = window.innerWidth / this.dims.width;
        let scaleFactorY = window.innerHeight / this.dims.height;
        let scale = new Point2D(scaleFactorX, scaleFactorY);

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

    shutdown(): void {
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

const fDebouncer = (fn: CallableFunction, thresholdMs: number, immediately: boolean = false) => {
    let bouncing: number | null;

    const debounceContext = () => {
        const delayedExecutor = () => {
            if (~immediately) {
                fn()
            }
            bouncing = null; // resets debouncer
        }

        if (bouncing) {
            clearTimeout(bouncing);
        }
        else if (immediately) {
            fn()
        }

        bouncing = setTimeout(delayedExecutor, thresholdMs);
    }
    return debounceContext;
}

function fHandleResize(controller: CanvasController, canvas: HTMLCanvasElement) {
    // NOTE: Debouncing adapted from:
    // - http://unscriptable.com/2009/03/20/debouncing-javascript-methods/
    // - https://www.paulirish.com/2009/throttled-smartresize-jquery-event-handler/

    const handleResize = () => {
        //console.log(`canvas.width: ${canvas.width}, canvas.height: ${canvas.height}`)
        //console.log(`window.innerWidth: ${window.innerWidth}, window.innerHeight: ${window.innerHeight}`)
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        controller.resize();
    };

    return handleResize;
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

const ctx = canvas.getContext("2d", {
    alpha: true // optimization: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas#turn_off_transparency
});
if (ctx === null) {
    throw new ReferenceError('Canvas failed to return 2d context');
}

const sun = new Sun({
    ctx: ctx,
    origin: new Point2D(ctx.canvas.width / 3, ctx.canvas.height / 2),
}, {
    radius: ctx.canvas.width / 7,
    minRadius: 100,
    maxRadius: 200,
    fillRgbHex: '#b8360f',
});

const NUM_WAVES = 16;
const yOffset = ctx.canvas.height / (2 * NUM_WAVES);
const ySinOffset = (Math.PI) / NUM_WAVES
const drawables: CanvasControllerDrawables = {
    simples: [sun],
    sequentials: {
        waves: [],
    }
}


const waveDrawProps = {
    yMagnitude: ctx.canvas.width / 4,
    minYMagnitude: 200,
    maxYMagnitude: 300,
    strokeRgbHex: '#a0a0cc95',
    xJitter: 0,
    yJitter: 0,
    lineWidth: 0.75,
}

for (let i = 0; i < NUM_WAVES; i++) {
    drawables.sequentials.waves.push(new Wave({
        // NOTE: WaveInitProps
        ctx: ctx,
        start: new Point2D(
            -10,
            ctx.canvas.height / 2 - (yOffset * NUM_WAVES) - (yOffset * i)
        ),
        end: new Point2D(
            ctx.canvas.width + 10,
            ctx.canvas.height / 2 + (0.25 * yOffset * NUM_WAVES) + (yOffset * i * 2)
        ),
        nPoints: 10,
        yPeriod: 2 * Math.PI / 3000, // NOTE: 1 period per 3000ms
        ySin: ySinOffset * i,
        sequenceNumber: i,
    }, waveDrawProps));
}

const fps = 60;
const controller = new CanvasController(ctx, fps, drawables);
controller.init();

const SIN_PERIOD = 2 * Math.PI;
const sampleCircle = () => {
    const random = Math.random() * SIN_PERIOD;
    const x = Math.cos(random) ** 2;
    return new Point2D(
        x,
        1 - x
    )

    console.log(`Computing ${NUM_SAMPLES} random points on a circle took ${(endTime - startTime)} ms`)
    setTimeout(sampleCircle, 0);
}
sampleCircle();

//setTimeout(controller.shutdown, 5 * 1000);
//controller.shutdown();

