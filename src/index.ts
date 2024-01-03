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

function animateFromContext(ctx: CanvasRenderingContext2D) {
    let previousTimestamp = 0;
    let radius = 200;
    let x = 0,
        y = 0,
        yy = 0;

    const xSpeed    = 500 / 1000;           // px/ms
    const yDispl    = 200;                  // px/ms
    const yPeriod   = 2*Math.PI / 2000;     // radians/ms, one full period per 2 secs

    const animate = function periodic(timestamp: number) {
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
        console.log(y);

        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

        ctx.fillStyle = '#da5225';
        ctx.beginPath();
        ctx.arc(x, y+ctx.canvas.height/2, 200, 0, 2*Math.PI);
        ctx.closePath();
        ctx.fill();

        previousTimestamp = timestamp;
        window.requestAnimationFrame(animate);
    }
    return animate;
};

window.requestAnimationFrame(animateFromContext(ctx));

