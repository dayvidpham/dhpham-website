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
    frameId: number;

    updateAndDraw(timeMs: number): void;
    shutdown(): void;
}

type Point2D = {
    readonly x: number;
    readonly y: number;
}





////////////////////////////////////////////////////
// Wave
////////////////////////////////////////////////////

type WaveProps = {
    readonly ctx:        CanvasRenderingContext2D;
    readonly start:      Point2D;
    readonly end:        Point2D;
    readonly yPeriod:    number;
    readonly ySin:       number;
    readonly nPoints:    number;
    //readonly xlinspace:  number;
}

class Wave implements Drawable {
    // Explicit
    readonly ctx:       CanvasRenderingContext2D;
    readonly start:     Point2D;
    readonly end:       Point2D;
    readonly yPeriod:   number;
    ySin:               number;
    readonly nPoints:   number;
    // Implicit or set later
    readonly xlinspace: number;
    readonly tStep:     number;
    prevTimeMs:         number;
    frameId:            number;

    constructor(props: WaveProps) {
        // Explicit
        this.ctx        = props.ctx;
        this.start      = props.start;
        this.end        = props.end;
        this.yPeriod    = props.yPeriod;
        this.ySin       = props.ySin;
        this.nPoints    = props.nPoints;
        // Implicit
        //this.nPoints    = Math.floor((this.end.x - this.start.x) / this.xlinspace);
        this.xlinspace  = (props.end.y - props.start.y) / props.nPoints;
        this.tStep      = 1 / this.nPoints;
        this.prevTimeMs = -1;
        this.frameId    = -1;
        // `this` will be undefined when re-called
        this.updateAndDraw  = this.updateAndDraw.bind(this);
        this.draw           = this.draw.bind(this);
        this.shutdown       = this.shutdown.bind(this);
    }

    updateAndDraw(timeMs: number) {
        if (this.prevTimeMs === -1) {
            this.prevTimeMs = timeMs;
        }

        const elapsed =  timeMs - this.prevTimeMs;
        this.ySin += elapsed*this.yPeriod;
        const yMagnitude    = 200,
              strokeRgbHex  = '#a0a0cc95',
              xJitter       = 0,
              yJitter       = 2,
              lineWidth     = 0.75;

        this.draw(this.ySin, yMagnitude, xJitter, yJitter, strokeRgbHex, lineWidth);
        this.prevTimeMs = timeMs;
    }

    draw(
      ySin: number, yMagnitude: number,
      xJitter: number, yJitter: number,
      strokeRgbHex: string, lineWidth: number
    ) {
        let x, y;
        this.ctx.beginPath();
        this.ctx.strokeStyle = strokeRgbHex;
        this.ctx.lineWidth = lineWidth;
        for(let t = 0; t <= 1; t += this.tStep) {
            x = lerp(this.start.x, this.end.x, t) 
                + getRandomBetween(-xJitter, xJitter);
            y = lerp(this.start.y, this.end.y, t) 
                + Math.sin(t*3*Math.PI + ySin)*yMagnitude
                + getRandomBetween(-yJitter, yJitter);

            /////////////////////
            // STROKE
            //this.ctx.strokeStyle = "black";
            this.ctx.lineTo(x, y);

            /////////////////////
            // FILL
            // this.ctx.fillStyle = "#fff";
            // this.ctx.arc(x, y, 3, 0, 2*Math.PI);
            // this.ctx.fill();
        }
        this.ctx.stroke();
        // this.ctx.strokeStyle = strokeRgbHex;
        // this.ctx.lineWidth = lineWidth-2;
        // this.ctx.stroke();
    }

    shutdown() {
        if(this.frameId === -1) {
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
    ctx:         CanvasRenderingContext2D;
    origin:      Point2D;
    radius:      number;
    fillRgbHex:  string;
}

class Sun implements Drawable {
    // Explicit
    readonly ctx:         CanvasRenderingContext2D;
    readonly origin:      Point2D;
    readonly radius:      number;
    readonly fillRgbHex:  string;
    // Implicit or set later
    prevTimeMs:         number;
    frameId:            number;

    constructor(props: SunProps) {
        // Explicit
        this.ctx        = props.ctx;
        this.origin     = props.origin;
        this.radius     = props.radius;
        this.fillRgbHex = props.fillRgbHex;
        // Implicit
        this.prevTimeMs = -1;
        this.frameId    = -1;
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

        this.draw(this.fillRgbHex);
        this.prevTimeMs = timeMs;
    }

    draw(
      fillRgbHex: string
    ) {
        this.ctx.beginPath();
        // FILL
        this.ctx.fillStyle = fillRgbHex;
        this.ctx.arc(this.origin.x, this.origin.y, this.radius, 0, 2*Math.PI);
        this.ctx.fill();
    }

    shutdown() {
        if(this.frameId === -1) {
            console.error('Calling shutdown() on Wave object but Wave object not in updateAndDraw loop');
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
class CanvasController {
    readonly ctx:   CanvasRenderingContext2D;
    readonly fps:   number;
    readonly fpMs:  number;
    drawables:      Drawable[];
    loopId:         number;

    constructor(
      ctx:        CanvasRenderingContext2D,
      fps:        number,
      drawables:  Drawable[],
    ) {
        // Explicit
        this.ctx        = ctx;
        this.fps        = fps;
        this.drawables  = drawables;
        // Implicit
        this.loopId     = -1;
        this.fpMs       = 1/fps*1000;
        // Bindings
        this.init = this.init.bind(this);
        this.shutdown = this.shutdown.bind(this);
    }

    init() {
        if (this.loopId != -1) {
            console.error('Called loop() in CanvasController instance when already looping. Returning.');
            return
        }
        const loop = () => {
            this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
            for(let i = 0; i < this.drawables.length; i++) {
                this.drawables[i].frameId = window.requestAnimationFrame(this.drawables[i].updateAndDraw);
            }
        };
        this.loopId = setInterval(loop, this.fpMs);
    }

    shutdown() {
        if (this.loopId === -1) {
            console.error('Called shutdown() in CanvasController instance when not yet looping. Returning.');
            return
        }
        clearInterval(this.loopId);
        this.loopId = -1;

        for(let i = 0; i < this.drawables.length; i++) {
            this.drawables[i].shutdown();
        }
    }
}

function handleResize (canvas: HTMLCanvasElement) {
    return function () {
        //console.log(`before: (${canvas.width}, ${canvas.height})`);
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        //console.log(`after: (${canvas.width}, ${canvas.height})`);
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
window.addEventListener('resize', handleResize(canvas));

const ctx = canvas.getContext("2d");
if (ctx === null) {
    throw new ReferenceError('Canvas failed to return 2d context');
}

const sun = new Sun({
    ctx:        ctx,
    origin:     { x: ctx.canvas.width/3, y: ctx.canvas.height/2 },
    radius:     Math.min(ctx.canvas.width / 7, 150),
    fillRgbHex: '#b8360f',
});
// console.log(`radius ${Math.min(ctx.canvas.width / 7, 150)}`);

const NUM_WAVES = 10;
const yOffset = ctx.canvas.height / (2*NUM_WAVES);
const ySinOffset = Math.PI / NUM_WAVES
const drawables: Drawable[] = [sun];
for(let i = 0; i < NUM_WAVES; i++) {
    drawables.push(new Wave({
        ctx:        ctx,
        start:      { x: -50, y: ctx.canvas.height/2 - yOffset*NUM_WAVES + yOffset*i*2 },
        end:        { x: ctx.canvas.width+50, y: ctx.canvas.height/2 + yOffset*NUM_WAVES - yOffset*i },
        yPeriod:    2*Math.PI / 3000,
        ySin:       ySinOffset*i,
        nPoints:    100,
    }));
}

const fps = 60;
const controller = new CanvasController(ctx, fps, drawables);
controller.init();
//setTimeout(controller.shutdown, 5*1000);
//controller.shutdown();

