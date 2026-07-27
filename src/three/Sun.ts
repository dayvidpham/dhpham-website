import * as THREE from 'three';
import { clamp } from '../Utils';

export type SunOptions = {
    origin: THREE.Vector2;
    radius: number;
    minRadius: number;
    maxRadius: number;
    color: THREE.ColorRepresentation;
    segments?: number;
};

export class Sun {
    readonly mesh: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;

    private radius: number;
    private readonly minRadius: number;
    private readonly maxRadius: number;
    private readonly baseRadius: number;
    private readonly baseOrigin: THREE.Vector2;

    constructor(opts: SunOptions) {
        this.minRadius = opts.minRadius;
        this.maxRadius = opts.maxRadius;
        this.radius = clamp(opts.radius, this.minRadius, this.maxRadius);
        this.baseRadius = this.radius;
        this.baseOrigin = opts.origin.clone();

        const geometry = new THREE.CircleGeometry(this.baseRadius, opts.segments ?? 96);
        const material = new THREE.MeshBasicMaterial({
            color: opts.color,
            side: THREE.DoubleSide,
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.set(opts.origin.x, opts.origin.y, 0);
    }

    resize = (scale: THREE.Vector2): void => {
        this.mesh.position.set(
            this.baseOrigin.x * scale.x,
            this.baseOrigin.y * scale.y,
            0,
        );
        this.radius = clamp(this.baseRadius * scale.x, this.minRadius, this.maxRadius);
        this.mesh.scale.setScalar(this.radius / this.baseRadius);
    }

    dispose = (): void => {
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}
