export default interface Drawable {
  frameId: number | null;

  updateAndDraw(timeMs: number): void;
  shutdown(): void;
}
