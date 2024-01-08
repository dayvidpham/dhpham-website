// import Wave from './Wave';
// maybe fuck the import: all in one file
// easier to keep track of

function lerp(x0: number, x1: number, t: number) {
    return x0+(x1-x0)*t
}
function getRandomBetween(x0: number, x1: number) {
    const low = Math.min(x0, x1);
    const high = Math.max(x0, x1);
    return Math.random()*(high-low) + low;
}
interface Drawable {
  updateAndDraw(timeMs: number): void;
  shutdown(): void;
}
type Point2D = {
    x: number;
    y: number;
}
type WaveProps = {
    ctx:        CanvasRenderingContext2D;
    start:      Point2D;
    end:        Point2D;
    yPeriod:    number;
    xlinspace:  number;
}
class Wave implements Drawable {
    // Explicit
    readonly ctx:       CanvasRenderingContext2D;
    readonly start:     Point2D;
    readonly end:       Point2D;
    readonly yPeriod:   number;
    readonly xlinspace: number;
    // Implicit or set later
    readonly nPoints:   number;
    readonly tStep:     number;
    ySin:               number;
    prevTimeMs:         number;
    frameId:            number | null;

    constructor(props: WaveProps) {
        // Explicit
        this.ctx        = props.ctx;
        this.start      = props.start;
        this.end        = props.end;
        this.yPeriod    = props.yPeriod;
        this.xlinspace  = props.xlinspace;
        // Implicit
        this.ySin       = 0;
        this.nPoints    = Math.floor((this.end.x - this.start.x) / this.xlinspace);
        this.tStep      = 1 / this.nPoints;
        this.prevTimeMs = -1;
        this.frameId    = null;
        // `this` will be undefined when re-called
        this.draw           = this.draw.bind(this);
        this.updateAndDraw  = this.updateAndDraw.bind(this);
        this.shutdown       = this.shutdown.bind(this);
    }

    updateAndDraw(timeMs: number) {
        if (this.prevTimeMs === -1) {
            this.prevTimeMs = timeMs;
        }

        const elapsed =  timeMs - this.prevTimeMs;
        this.ySin += elapsed * this.yPeriod;
        const yMagnitude    = 100,
              strokeRgbHex  = '#ccc',
              xJitter       = 2,
              yJitter       = 4,
              lineWidth     = 0.75;

        this.draw(this.ySin, yMagnitude, xJitter, yJitter, strokeRgbHex, lineWidth);
        this.prevTimeMs = timeMs;
        this.frameId = window.requestAnimationFrame(this.updateAndDraw);
    }

    draw(
      ySin: number, yMagnitude: number,
      xJitter: number, yJitter: number,
      strokeRgbHex: string, lineWidth: number
    ) {
        let x, y;
        this.ctx.beginPath();
        for(let t = 0; t <= 1; t += this.tStep) {
            x = lerp(this.start.x, this.end.x, t) + getRandomBetween(-xJitter, xJitter);
            y = lerp(this.start.y, this.end.y, t) 
                + Math.sin(t*4*Math.PI + ySin)*yMagnitude 
                + getRandomBetween(-yJitter, yJitter);

            /////////////////////
            // STROKE
            // this.ctx.beginPath();
            this.ctx.strokeStyle = strokeRgbHex;
            this.ctx.lineWidth = lineWidth;
            this.ctx.lineTo(x, y);

            /////////////////////
            // FILL
            // this.ctx.fillStyle = "#fff";
            // this.ctx.arc(x, y, 10, 0, 2*Math.PI);
            // this.ctx.fill();
        }
        this.ctx.stroke();
    }

    shutdown() {
        if(this.frameId == null) {
            console.error('Calling shutdown() on Wave object but Wave object not in updateAndDraw loop');
            return
        }
        window.cancelAnimationFrame(this.frameId);
        this.frameId = null;
    }
}

class CanvasController {
    readonly ctx:   CanvasRenderingContext2D;
    readonly fps:   number;
    drawables:      Drawable[];
    //loopId:         number | null;
    isLooping:      boolean;

    constructor(
      ctx:        CanvasRenderingContext2D,
      fps:        number,
      drawables:  Drawable[],
    ) {
        this.ctx        = ctx;
        this.fps        = fps;
        this.drawables  = drawables;
        this.isLooping  = false;

        this.init = this.init.bind(this);
        this.shutdown = this.shutdown.bind(this);
    }

    init() {
        if (this.isLooping) {
            console.error('Called loop() in CanvasController instance when already looping. Returning.');
            return
        }
        for(let i = 0; i < this.drawables.length; i++) {
            window.requestAnimationFrame(this.drawables[i].updateAndDraw);
        }
    }

    shutdown() {
        if (this.isLooping == false) {
            console.error('Called shutdown() in CanvasController instance when not yet looping. Returning.');
            return
        }
        for(let i = 0; i < this.drawables.length; i++) {
            this.drawables[i].shutdown();
        }
    }
}

function handleResize (canvas: HTMLCanvasElement) {
    return function () {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    };
};

// Init canvas
const canvasQuery: HTMLCanvasElement | null = document.querySelector("#main-canvas");
if (canvasQuery == null) {
    throw new ReferenceError('Could not find #main-canvas element: something is horribly wrong. Exiting ...');
}
const canvas: HTMLCanvasElement = canvasQuery;
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
window.addEventListener('resize', handleResize(canvas));

const ctx = canvas.getContext("2d");
if (ctx == null) {
    throw new ReferenceError('Canvas failed to return 2d context');
}

const wave = new Wave({
    ctx: ctx,
    start:      { x: 0, y: ctx.canvas.height / 2 },
    end:        { x: ctx.canvas.width, y: ctx.canvas.height / 2 },
    yPeriod:    2*Math.PI / 2000,
    xlinspace:  10,
});

function animateFromContext(ctx: CanvasRenderingContext2D) {
    let previousTimestamp = 0;
    let radius = 200;
    let x = 0,
        y = 0,
        yy = 0;

    const xSpeed    = 500 / 1000;           // px/ms
    const yDispl    = 200;                  // px/ms
    const yPeriod   = 2*Math.PI / 2000;     // radians/ms, one full period per 2 secs

    const render = function periodic(timestamp: number) {
        if(previousTimestamp === 0) {
            previousTimestamp = timestamp;
        }

        const update = timestamp - previousTimestamp;

        x += update*xSpeed;
        if(x > ctx.canvas.width + radius) {
            x = -radius
        }

        yy += update*yPeriod;
        y = yDispl*Math.sin(yy);

        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

        ctx.fillStyle = '#da5225';
        ctx.beginPath();
        ctx.arc(x, y+ctx.canvas.height/2, 200, 0, 2*Math.PI);
        ctx.closePath();
        ctx.fill();

        previousTimestamp = timestamp;
        window.requestAnimationFrame(render);
    }
    return render;
};

window.requestAnimationFrame(animateFromContext(ctx));

const fps = 60;
const controller = new CanvasController(ctx, fps, [wave]);
controller.init();
//controller.shutdown();
