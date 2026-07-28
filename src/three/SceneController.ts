import * as THREE from 'three';
import { NavigationAnchor, SiteRoute } from './NavigationAnchor';
import { Planet } from './Planet';
import { RingSystem } from './RingSystem';
import { Sun } from './Sun';
import { Wave } from './Wave';

export type Viewport = Readonly<{
    width: number;
    height: number;
}>;

export type SceneRenderer = {
    setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
    setPixelRatio(pixelRatio: number): void;
    setSize(width: number, height: number): void;
    render(scene: THREE.Scene, camera: THREE.Camera): void;
    dispose(): void;
};

export type ResizeListenerTarget = {
    addEventListener(type: 'resize', listener: () => void): void;
    removeEventListener(type: 'resize', listener: () => void): void;
};

export type AnimationScheduler = {
    requestAnimationFrame(callback: (timeMs: number) => void): number;
    cancelAnimationFrame(requestId: number): void;
};

export type SceneControllerOptions = {
    canvas: HTMLCanvasElement;
    navigationElement: HTMLAnchorElement;
    renderer?: SceneRenderer;
    getViewport?: () => Viewport;
    getDevicePixelRatio?: () => number;
    resizeTarget?: ResizeListenerTarget;
    animationScheduler?: AnimationScheduler;
};

const WAVE_COUNT = 10;
const WAVE_ANCHOR_POINTS = 72;
const WAVE_Y_SIN_PERIOD_MS = (2 * Math.PI) / 3000;

const getBrowserViewport = (): Viewport => ({
    width: window.innerWidth,
    height: window.innerHeight,
});

const getBrowserPixelRatio = (): number => window.devicePixelRatio;

const getBrowserResizeTarget = (): ResizeListenerTarget => ({
    addEventListener: (type, listener) => window.addEventListener(type, listener),
    removeEventListener: (type, listener) => window.removeEventListener(type, listener),
});

const getBrowserAnimationScheduler = (): AnimationScheduler => ({
    requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
    cancelAnimationFrame: (requestId) => window.cancelAnimationFrame(requestId),
});

/**
 * Owns every browser-side scene resource: its stable resize listener, render
 * loop, Three primitives, and semantic Blog target.
 */
export class SceneController {
    readonly scene = new THREE.Scene();
    readonly camera: THREE.OrthographicCamera;
    readonly renderer: SceneRenderer;
    readonly sun: Sun;
    readonly waves: readonly Wave[];
    readonly planet: Planet;
    readonly rings: RingSystem;
    readonly navigationAnchor: NavigationAnchor;

    private readonly baseViewport: Viewport;
    private readonly getViewport: () => Viewport;
    private readonly getDevicePixelRatio: () => number;
    private readonly resizeTarget: ResizeListenerTarget;
    private readonly animationScheduler: AnimationScheduler;
    private previousFrameMs: number | undefined;
    private animationFrameRequest: number | undefined;
    private listeningForResize = false;
    private running = false;
    private disposed = false;

    constructor(opts: SceneControllerOptions) {
        this.getViewport = opts.getViewport ?? getBrowserViewport;
        this.getDevicePixelRatio = opts.getDevicePixelRatio ?? getBrowserPixelRatio;
        this.resizeTarget = opts.resizeTarget ?? getBrowserResizeTarget();
        this.animationScheduler = opts.animationScheduler ?? getBrowserAnimationScheduler();
        this.baseViewport = this.getViewport();
        this.assertViewport(this.baseViewport);

        this.renderer = opts.renderer ?? new THREE.WebGLRenderer({
            canvas: opts.canvas,
            antialias: true,
        });
        this.scene.background = new THREE.Color('#131313');
        this.renderer.setClearColor('#131313', 1);
        this.camera = new THREE.OrthographicCamera(
            0,
            this.baseViewport.width,
            0,
            this.baseViewport.height,
            0.1,
            100,
        );
        this.camera.position.z = 10;

        const minDimension = Math.min(this.baseViewport.width, this.baseViewport.height);
        this.sun = new Sun({
            origin: new THREE.Vector2(
                this.baseViewport.width * 0.2,
                this.baseViewport.height * 0.23,
            ),
            radius: minDimension * 0.13,
            minRadius: 42,
            maxRadius: 112,
            color: '#b8360f',
            z: -4,
        });
        this.scene.add(this.sun.mesh);

        const sunDistortion = this.sun.toDistortion(0.62);
        this.waves = Array.from({ length: WAVE_COUNT }, (_, index) => {
            const wave = new Wave({
                start: new THREE.Vector2(
                    -this.baseViewport.width * 0.1,
                    this.baseViewport.height * 0.08 + index * this.baseViewport.height * 0.055,
                ),
                end: new THREE.Vector2(
                    this.baseViewport.width * 1.1,
                    this.baseViewport.height * 0.44 + index * this.baseViewport.height * 0.065,
                ),
                numPoints: WAVE_ANCHOR_POINTS,
                ySin: ((Math.PI * 1.3) / WAVE_COUNT) * index,
                ySinPeriodMs: WAVE_Y_SIN_PERIOD_MS,
                yMagnitude: this.baseViewport.width * 0.1,
                minYMagnitude: 52,
                maxYMagnitude: 160,
                xJitter: 0,
                yJitter: 0,
                color: '#a0a0cc',
                opacity: 0x95 / 0xff,
                z: -2,
                sunDistortion,
            });
            this.scene.add(wave.line);
            return wave;
        });

        this.planet = new Planet({
            origin: new THREE.Vector2(
                this.baseViewport.width * 0.76,
                this.baseViewport.height * 0.72,
            ),
            radius: minDimension * 0.19,
            minRadius: 70,
            maxRadius: 154,
            color: '#7a78b8',
            z: 1,
        });
        this.scene.add(this.planet.mesh);

        this.rings = new RingSystem({
            center: this.planet.worldPosition,
            radiusX: this.planet.currentRadius * 1.75,
            radiusY: this.planet.currentRadius * 0.52,
            z: this.planet.mesh.position.z,
            color: '#d1d1ee',
            seed: 0x0b10_6a,
        });
        this.scene.add(this.rings.back, this.rings.front);

        this.navigationAnchor = new NavigationAnchor({
            element: opts.navigationElement,
            route: SiteRoute.Blog,
            label: 'blog',
            worldPosition: this.rings.navigationPosition,
            hitSize: this.rings.navigationHitSize,
        });
        this.resize(this.baseViewport);
        this.renderFrame(0);
    }

    start = (): void => {
        if (this.running || this.disposed) return;
        this.running = true;
        this.previousFrameMs = undefined;
        this.resize(this.getViewport());
        this.resizeTarget.addEventListener('resize', this.handleResize);
        this.listeningForResize = true;
        this.scheduleAnimationFrame();
    }

    resize = (viewport: Viewport): void => {
        if (this.disposed) return;
        this.assertViewport(viewport);
        const scale = new THREE.Vector2(
            viewport.width / this.baseViewport.width,
            viewport.height / this.baseViewport.height,
        );

        this.camera.right = viewport.width;
        this.camera.bottom = viewport.height;
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(Math.min(this.getDevicePixelRatio(), 2));
        this.renderer.setSize(viewport.width, viewport.height);

        this.sun.resize(scale);
        this.waves.forEach((wave) => wave.resize(scale));
        this.planet.resize(scale);
        this.rings.resize(scale);
        this.navigationAnchor.sync(
            this.rings.navigationPosition,
            this.rings.navigationHitSize,
        );
    }

    stop = (): void => {
        if (!this.running) return;
        this.running = false;
        this.previousFrameMs = undefined;
        if (this.animationFrameRequest !== undefined) {
            this.animationScheduler.cancelAnimationFrame(this.animationFrameRequest);
            this.animationFrameRequest = undefined;
        }
        if (this.listeningForResize) {
            this.resizeTarget.removeEventListener('resize', this.handleResize);
            this.listeningForResize = false;
        }
    }

    dispose = (): void => {
        if (this.disposed) return;
        this.stop();
        this.disposed = true;
        this.sun.dispose();
        this.waves.forEach((wave) => wave.dispose());
        this.planet.dispose();
        this.rings.dispose();
        this.scene.clear();
        this.renderer.dispose();
    }

    private handleResize = (): void => {
        this.resize(this.getViewport());
    }

    private handleAnimationFrame = (timeMs: number): void => {
        if (!this.running || this.disposed) return;
        this.animationFrameRequest = undefined;
        this.renderFrame(timeMs);
        this.scheduleAnimationFrame();
    }

    private scheduleAnimationFrame = (): void => {
        this.animationFrameRequest = this.animationScheduler.requestAnimationFrame(
            this.handleAnimationFrame,
        );
    }

    private renderFrame = (timeMs: number): void => {
        const deltaMs = this.previousFrameMs === undefined ? 0 : timeMs - this.previousFrameMs;
        this.previousFrameMs = timeMs;
        this.waves.forEach((wave) => wave.update(deltaMs));
        this.rings.update(deltaMs);
        this.navigationAnchor.sync(
            this.rings.navigationPosition,
            this.rings.navigationHitSize,
        );
        this.renderer.render(this.scene, this.camera);
    }

    private assertViewport = (viewport: Viewport): void => {
        if (
            !Number.isFinite(viewport.width)
            || !Number.isFinite(viewport.height)
            || viewport.width <= 0
            || viewport.height <= 0
        ) {
            throw new Error(
                'SceneController could not size the scene because the browser viewport '
                + 'was not a positive finite width and height.',
            );
        }
    }
}
