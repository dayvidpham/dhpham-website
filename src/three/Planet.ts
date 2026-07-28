import * as THREE from 'three';
import { clamp } from '../Utils';

export type PlanetOptions = {
    origin: THREE.Vector2;
    radius: number;
    minRadius: number;
    maxRadius: number;
    color: THREE.ColorRepresentation;
    segments?: number;
    z?: number;
};

/** A foreground planet whose layout is always derived from the initial viewport. */
export class Planet {
    readonly mesh: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;

    private readonly baseOrigin: THREE.Vector2;
    private readonly baseRadius: number;
    private readonly minRadius: number;
    private readonly maxRadius: number;
    private readonly z: number;
    private radius: number;
    private disposed = false;

    constructor(opts: PlanetOptions) {
        this.baseOrigin = opts.origin.clone();
        this.minRadius = opts.minRadius;
        this.maxRadius = opts.maxRadius;
        this.radius = clamp(opts.radius, this.minRadius, this.maxRadius);
        this.baseRadius = this.radius;
        this.z = opts.z ?? 1;

        this.mesh = new THREE.Mesh(
            new THREE.CircleGeometry(this.baseRadius, opts.segments ?? 96),
            new THREE.MeshBasicMaterial({
                color: opts.color,
                side: THREE.DoubleSide,
            }),
        );
        this.mesh.position.set(opts.origin.x, opts.origin.y, this.z);
    }

    get currentRadius(): number {
        return this.radius;
    }

    get worldPosition(): THREE.Vector2 {
        return new THREE.Vector2(this.mesh.position.x, this.mesh.position.y);
    }

    resize = (scale: THREE.Vector2): void => {
        this.mesh.position.set(
            this.baseOrigin.x * scale.x,
            this.baseOrigin.y * scale.y,
            this.z,
        );
        this.radius = clamp(this.baseRadius * scale.x, this.minRadius, this.maxRadius);
        this.mesh.scale.setScalar(this.radius / this.baseRadius);
    }

    dispose = (): void => {
        if (this.disposed) return;
        this.disposed = true;
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}
