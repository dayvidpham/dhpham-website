import * as THREE from 'three';
import { clamp } from '../Utils';

export type SunOptions = {
    origin: THREE.Vector2;
    radius: number;
    minRadius: number;
    maxRadius: number;
    color: THREE.ColorRepresentation;
    segments?: number;
    z?: number;
};

/**
 * The typed input that lets waves bend around a Sun without depending on a
 * particular Sun instance at runtime.
 */
export type SunDistortion = Readonly<{
    origin: THREE.Vector2;
    radius: number;
    strength: number;
}>;

export class Sun {
    readonly mesh: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;

    private radius: number;
    private readonly minRadius: number;
    private readonly maxRadius: number;
    private readonly baseRadius: number;
    private readonly baseOrigin: THREE.Vector2;
    private readonly z: number;
    private disposed = false;

    constructor(opts: SunOptions) {
        this.minRadius = opts.minRadius;
        this.maxRadius = opts.maxRadius;
        this.radius = clamp(opts.radius, this.minRadius, this.maxRadius);
        this.baseRadius = this.radius;
        this.baseOrigin = opts.origin.clone();
        this.z = opts.z ?? 0;

        const geometry = new THREE.CircleGeometry(this.baseRadius, opts.segments ?? 96);
        const material = new THREE.MeshBasicMaterial({
            color: opts.color,
            side: THREE.DoubleSide,
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.set(opts.origin.x, opts.origin.y, this.z);
    }

    get currentRadius(): number {
        return this.radius;
    }

    toDistortion = (strength: number): SunDistortion => ({
        origin: new THREE.Vector2(this.mesh.position.x, this.mesh.position.y),
        radius: this.radius,
        strength,
    });

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
