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
    throw new ReferenceError('Canvas cannot return 2d context');
}

ctx.fillStyle = '#da5225';
ctx.beginPath();
ctx.arc(canvas.width/2, canvas.height/2, 200, 0, 2*Math.PI);
ctx.closePath();
ctx.fill();
