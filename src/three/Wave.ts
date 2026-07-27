import * as THREE from 'three';
import { noise } from '../Perlin';
import { clamp, getRandomBetween } from '../Utils';

export type WaveOptions = {
    start: THREE.Vector2;
    end: THREE.Vector2;
    numPoints: number;
    ySin: number;
    ySinPeriodMs: number;
    yMagnitude: number;
    minYMagnitude: number;
    maxYMagnitude: number;
    xJitter: number;
    yJitter: number;
    color: THREE.ColorRepresentation;
    opacity: number;
    z?: number;
};

export class Wave {
    readonly line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;

    private start: THREE.Vector2;
    private end: THREE.Vector2;
    private readonly baseStart: THREE.Vector2;
    private readonly baseEnd: THREE.Vector2;
    private readonly numPoints: number;
    private readonly ySinPeriodMs: number;
    private ySin: number;
    private yMagnitude: number;
    private readonly baseYMagnitude: number;
    private readonly minYMagnitude: number;
    private readonly maxYMagnitude: number;
    private readonly xJitter: number;
    private readonly yJitter: number;

    private readonly anchorXs: Float32Array;
    private readonly baseAnchorXs: Float32Array;
    private readonly positions: Float32Array;
    private readonly positionAttr: THREE.BufferAttribute;
    private xlinspace: number;
    private ylinspace: number;
    private readonly tAnchorLinspace: number;
    private accumTimeMs: number;

    constructor(opts: WaveOptions) {
        this.start = opts.start.clone();
        this.end = opts.end.clone();
        this.baseStart = this.start.clone();
        this.baseEnd = this.end.clone();
        this.numPoints = opts.numPoints;
        this.ySinPeriodMs = opts.ySinPeriodMs;
        this.ySin = opts.ySin;
        this.minYMagnitude = opts.minYMagnitude;
        this.maxYMagnitude = opts.maxYMagnitude;
        this.yMagnitude = clamp(opts.yMagnitude, this.minYMagnitude, this.maxYMagnitude);
        this.baseYMagnitude = this.yMagnitude;
        this.xJitter = opts.xJitter;
        this.yJitter = opts.yJitter;

        this.xlinspace = (this.end.x - this.start.x) / ((this.numPoints - 1) || 1);
        this.ylinspace = (this.end.y - this.start.y) / ((this.numPoints - 1) || 1);
        this.tAnchorLinspace = 1 / this.numPoints;
        this.accumTimeMs = 0;

        this.anchorXs = new Float32Array(this.numPoints);
        let x = this.start.x;
        for (let i = 0; i < this.numPoints; i++) {
            this.anchorXs[i] = x + getRandomBetween(-this.xJitter, this.xJitter);
            x += this.xlinspace;
        }
        this.baseAnchorXs = this.anchorXs.slice();

        this.positions = new Float32Array(this.numPoints * 3);
        this.positionAttr = new THREE.BufferAttribute(this.positions, 3);
        this.positionAttr.setUsage(THREE.DynamicDrawUsage);

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', this.positionAttr);

        const material = new THREE.LineBasicMaterial({
            color: opts.color,
            transparent: opts.opacity < 1,
            opacity: opts.opacity,
        });

        this.line = new THREE.Line(geometry, material);
        this.line.position.z = opts.z ?? 1;
        this.line.frustumCulled = false;
    }

    update = (deltaMs: number): void => {
        this.ySin += deltaMs * this.ySinPeriodMs;
        this.accumTimeMs += deltaMs;

        const perlinStep = this.accumTimeMs * 0.001;
        let y = this.start.y;
        let x = this.start.x;
        let tAnchor = 0;

        for (let i = 0; i < this.numPoints; i++) {
            const yPerlinSample = noise(x, y + perlinStep, perlinStep);
            const perlinWeight = Math.sin(-Math.PI / 4 + tAnchor * 1.25 * Math.PI) ** 4;
            const yPerlin = yPerlinSample * 32 * perlinWeight;

            const xPerlinSample = noise(x + perlinStep, y, perlinStep);
            const xPerlin = xPerlinSample * 16 * perlinWeight;

            const posY =
                y
                + yPerlin
                + Math.sin(tAnchor * 3 * Math.PI + this.ySin) * this.yMagnitude
                + getRandomBetween(-this.yJitter, this.yJitter);
            const posX = this.anchorXs[i] + xPerlin;

            const idx = i * 3;
            this.positions[idx] = posX;
            this.positions[idx + 1] = posY;
            this.positions[idx + 2] = 0;

            x += this.xlinspace;
            y += this.ylinspace;
            tAnchor += this.tAnchorLinspace;
        }

        this.positionAttr.needsUpdate = true;
    }

    resize = (scale: THREE.Vector2): void => {
        this.start.copy(this.baseStart).multiply(scale);
        this.end.copy(this.baseEnd).multiply(scale);
        this.xlinspace = (this.end.x - this.start.x) / ((this.numPoints - 1) || 1);
        this.ylinspace = (this.end.y - this.start.y) / ((this.numPoints - 1) || 1);
        for (let i = 0; i < this.numPoints; i++) {
            this.anchorXs[i] = this.baseAnchorXs[i] * scale.x;
        }
        this.yMagnitude = clamp(this.baseYMagnitude * scale.x, this.minYMagnitude, this.maxYMagnitude);
    }

    dispose = (): void => {
        this.line.geometry.dispose();
        this.line.material.dispose();
    }
}
