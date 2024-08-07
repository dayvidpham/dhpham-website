import { Wave } from './Wave';
import { Sun } from './Sun';
import { Drawable, Sequential, Point2D } from './Primitive';

////////////////////////////////////////////////////
// CanvasController
////////////////////////////////////////////////////

export type CanvasControllerDrawables = {
    static: Drawable[],
    sequentials: Record<string, (Sequential & Drawable)[]>,
};

export class CanvasController {
    // Explicit
    readonly fps: number;
    drawables: CanvasControllerDrawables;

    // Implicit
    mainCtx: CanvasRenderingContext2D;
    staticCtx: CanvasRenderingContext2D;
    loopId: number;
    readonly fpMs: number;
    dims: {
        width: number,
        height: number,
    }
    backgroundColor: string;

    constructor(
        fps: number,
        drawables: CanvasControllerDrawables,
    ) {
        // Explicit
        this.fps = fps;
        this.drawables = drawables;

        // Implicit
        this.loopId = -1;
        this.fpMs = 1 / fps * 1000;
        this.dims = {
            width: window.innerWidth,
            height: window.innerHeight,
        };
        this.backgroundColor = '#131313';

        this.mainCtx = this.initContext('#main-canvas', { alpha: true });
        // optimization: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas#turn_off_transparency
        this.staticCtx = this.initContext('#static-canvas', { alpha: false });
    }

    init = (): void => {
        if (this.loopId != -1) {
            console.error('Called loop() in CanvasController instance when already looping. Returning.');
            return
        }

        this.initStatic();
        this.initMain();

        window.addEventListener('resize', this.resize);

        this.loopId = setInterval(this.renderLoop, this.fpMs);
    }

    private initStatic = (): void => {
        this.drawBackground(this.backgroundColor);

        const sun = new Sun({
            ctx: this.staticCtx,
            origin: new Point2D(this.mainCtx.canvas.width / 3, this.mainCtx.canvas.height / 2),
        }, {
            radius: this.mainCtx.canvas.width / 7,
            minRadius: 100,
            maxRadius: 200,
            fillRgbHex: '#b8360f',
        });

        this.drawables.static.push(sun);
    }

    private drawBackground = (backgroundColor: string): void => {
        this.staticCtx.save();
        this.staticCtx.fillStyle = backgroundColor;
        this.staticCtx.fillRect(0, 0, this.staticCtx.canvas.width, this.staticCtx.canvas.height);
        this.staticCtx.restore();
    }


    private initMain = (): void => {
        const NUM_WAVES = 10;
        const WAVE_NUM_ANCHOR_POINTS = 64 * 1;
        const WAVE_Y_SIN_PERIOD_RAD = 2 * Math.PI; // NOTE: 1 period per 3000ms 
        const WAVE_Y_SIN_PERIOD_MS = WAVE_Y_SIN_PERIOD_RAD / 3000; // NOTE: 1 period per 3000ms 
        const WAVE_Y_SIN_OFFSET = (Math.PI * 1.3) / NUM_WAVES

        const yOffset = this.mainCtx.canvas.height / (2 * NUM_WAVES);

        const waveDrawProps = {
            yMagnitude: this.mainCtx.canvas.width * 0.1,
            minYMagnitude: 125,
            maxYMagnitude: 170,
            strokeRgbHex: '#a0a0cc95',
            xJitter: 0,
            yJitter: 0,
            lineWidth: 0.75,
        }

        let wave: Wave;
        for (let i = 0; i < NUM_WAVES; i++) {
            wave = new Wave(
                // NOTE: WaveInitProps
                {
                    ctx: this.mainCtx,
                    start: new Point2D(
                        -10,
                        this.mainCtx.canvas.height / 2 - (yOffset * NUM_WAVES) - (yOffset * i)
                    ),
                    end: new Point2D(
                        this.mainCtx.canvas.width + 10,
                        this.mainCtx.canvas.height / 2 + (0.25 * yOffset * NUM_WAVES) + (yOffset * i * 2)
                    ),
                    numPoints: WAVE_NUM_ANCHOR_POINTS,
                    ySinPeriodMs: WAVE_Y_SIN_PERIOD_MS, // NOTE: 1 period per 3000ms
                    ySin: WAVE_Y_SIN_OFFSET * i,
                    sequenceNumber: i,
                },
                waveDrawProps
            )
            this.drawables.sequentials.waves.push(wave);
        }
    }

    private initContext = (
        canvasQuery: string,
        contextOpts?: CanvasRenderingContext2DSettings,
    ): CanvasRenderingContext2D => {
        const canvas = this.queryCanvas(canvasQuery);

        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const context = canvas.getContext("2d", contextOpts) as CanvasRenderingContext2D;
        if (context === null) {
            throw new ReferenceError('Canvas failed to return 2d context');
        }
        return context;
    }

    private queryCanvas = (query: string): HTMLCanvasElement => {
        const selectorResult: HTMLElement | null = document.querySelector(query);
        if (selectorResult === null
            || !(selectorResult instanceof HTMLCanvasElement)) {
            throw new ReferenceError(`Could not find ${query} element: something is horribly wrong. Exiting ...`);
        }
        return selectorResult;
    }

    renderLoop = (): void => {
        this.mainCtx.clearRect(0, 0, this.mainCtx.canvas.width, this.mainCtx.canvas.height);

        for (let i = 0; i < this.drawables.static.length; i++) {
            this.drawables.static[i].frameId = window.requestAnimationFrame(this.drawables.static[i].render);
        }

        for (let seq_type in this.drawables.sequentials) {
            let seqs = this.drawables.sequentials[seq_type]
            for (let i = 0; i < seqs.length; i++) {
                seqs[i].frameId = window.requestAnimationFrame(seqs[i].render);
            }
        }
    };

    private resize = (): void => {
        let scaleFactorX = window.innerWidth / this.dims.width;
        let scaleFactorY = window.innerHeight / this.dims.height;
        let scale = new Point2D(scaleFactorX, scaleFactorY);

        this.mainCtx.canvas.width = window.innerWidth;
        this.mainCtx.canvas.height = window.innerHeight;

        this.staticCtx.canvas.width = window.innerWidth;
        this.staticCtx.canvas.height = window.innerHeight;
        this.drawBackground(this.backgroundColor);

        this.dims.width = window.innerWidth;
        this.dims.height = window.innerHeight;

        for (let i = 0; i < this.drawables.static.length; i++) {
            this.drawables.static[i].resize(scale);
        }

        for (let seq_type in this.drawables.sequentials) {
            let seqs = this.drawables.sequentials[seq_type]
            for (let i = 0; i < seqs.length; i++) {
                seqs[i].resize(scale)
            }
        }
    }

    shutdown = (): void => {
        if (this.loopId === -1) {
            console.error('Called shutdown() in CanvasController instance when not yet looping. Returning.');
            return
        }
        clearInterval(this.loopId);
        this.loopId = -1;

        for (let i = 0; i < this.drawables.static.length; i++) {
            this.drawables.static[i].shutdown();
        }

        for (let seq_type in this.drawables.sequentials) {
            let seqs = this.drawables.sequentials[seq_type]
            for (let i = 0; i < seqs.length; i++) {
                seqs[i].shutdown();
            }
        }
    }
}
