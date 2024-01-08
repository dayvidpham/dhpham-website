import Drawable from './Drawable';

type WaveProps = {
    readonly ctx:        CanvasRenderingContext2D;
    readonly start:      Point2D;
    readonly end:        Point2D;
    readonly yPeriod:    number;
    readonly ySin:       number;
    readonly xlinspace:  number;
}

class Wave implements Drawable {
    // Explicit
    readonly ctx:       CanvasRenderingContext2D;
    readonly start:     Point2D;
    readonly end:       Point2D;
    readonly yPeriod:   number;
    ySin:               number;
    readonly xlinspace: number;
    // Implicit or set later
    readonly nPoints:   number;
    readonly tStep:     number;
    prevTimeMs:         number;
    frameId:            number;

    constructor(props: WaveProps) {
        // Explicit
        this.ctx        = props.ctx;
        this.start      = props.start;
        this.end        = props.end;
        this.yPeriod    = props.yPeriod;
        this.ySin       = 0;
        this.xlinspace  = props.xlinspace;
        // Implicit
        this.nPoints    = Math.floor((this.end.x - this.start.x) / this.xlinspace);
        this.tStep      = 1 / this.nPoints;
        this.prevTimeMs = -1;
        this.frameId    = 0;
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
        const yMagnitude    = 100,
              strokeRgbHex  = '#ccc',
              xJitter       = 2,
              yJitter       = 4,
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
            this.ctx.arc(x, y, 10, 0, 2*Math.PI);
            // this.ctx.fill();
        }
        this.ctx.stroke();
    }

    shutdown() {
        if(this.frameId === 0) {
            console.error('Calling shutdown() on Wave object but Wave object not in updateAndDraw loop');
            return
        }
        window.cancelAnimationFrame(this.frameId);
        this.frameId = 0;
    }
}

