const hello: String = "Hello, World";
const canvas: HTMLCanvasElement | null = document.querySelector("#main-canvas");
const ctx = canvas?.getContext("2d");
console.log(ctx);
