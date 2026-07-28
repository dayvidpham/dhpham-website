import * as THREE from 'three';

export type RingSystemOptions = {
    center: THREE.Vector2;
    radiusX: number;
    radiusY: number;
    z: number;
    color: THREE.ColorRepresentation;
    particlesPerHalf?: number;
    particleSize?: number;
    seed?: number;
    orbitRadiansPerMillisecond?: number;
};

type SeededParticles = {
    readonly angles: Float32Array;
    readonly radialOffsets: Float32Array;
    readonly speeds: Float32Array;
};

const FULL_ORBIT = Math.PI * 2;

const seededRandom = (seed: number): (() => number) => {
    let state = seed >>> 0;
    return () => {
        state = (1664525 * state + 1013904223) >>> 0;
        return state / 0x1_0000_0000;
    };
};

/**
 * A ring is deliberately represented by exactly two draw calls: its rear and
 * front halves. Particles are generated once from a local seed, then their
 * existing attribute buffers are updated in place as they orbit.
 */
export class RingSystem {
    readonly back: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
    readonly front: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
    readonly navigationPosition = new THREE.Vector2();
    readonly navigationHitSize = new THREE.Vector2();

    private readonly particles: SeededParticles;
    private readonly backPosition: THREE.BufferAttribute;
    private readonly frontPosition: THREE.BufferAttribute;
    private readonly baseCenter: THREE.Vector2;
    private readonly baseRadiusX: number;
    private readonly baseRadiusY: number;
    private readonly z: number;
    private readonly orbitRadiansPerMillisecond: number;
    private center: THREE.Vector2;
    private radiusX: number;
    private radiusY: number;
    private phase = 0;
    private disposed = false;

    constructor(opts: RingSystemOptions) {
        const particlesPerHalf = opts.particlesPerHalf ?? 140;
        if (!Number.isInteger(particlesPerHalf) || particlesPerHalf < 1) {
            throw new Error('RingSystem requires at least one particle per ring half.');
        }

        this.baseCenter = opts.center.clone();
        this.center = opts.center.clone();
        this.baseRadiusX = opts.radiusX;
        this.baseRadiusY = opts.radiusY;
        this.radiusX = opts.radiusX;
        this.radiusY = opts.radiusY;
        this.z = opts.z;
        this.orbitRadiansPerMillisecond = opts.orbitRadiansPerMillisecond ?? 0.00018;

        const random = seededRandom(opts.seed ?? 0x81_5e_1c);
        this.particles = this.createParticles(particlesPerHalf, random);
        const particleCapacity = particlesPerHalf * 2;
        this.backPosition = this.createPositionBuffer(particleCapacity);
        this.frontPosition = this.createPositionBuffer(particleCapacity);
        this.back = this.createPoints(this.backPosition, opts, this.z - 0.5);
        this.front = this.createPoints(this.frontPosition, opts, this.z + 0.5);
        this.updateGeometry();
    }

    update = (deltaMs: number): void => {
        if (this.disposed) return;
        this.phase += deltaMs * this.orbitRadiansPerMillisecond;
        this.updateGeometry();
    }

    resize = (scale: THREE.Vector2): void => {
        if (this.disposed) return;
        this.center.copy(this.baseCenter).multiply(scale);
        this.radiusX = this.baseRadiusX * scale.x;
        this.radiusY = this.baseRadiusY * scale.y;
        this.updateGeometry();
    }

    dispose = (): void => {
        if (this.disposed) return;
        this.disposed = true;
        this.back.geometry.dispose();
        this.back.material.dispose();
        this.front.geometry.dispose();
        this.front.material.dispose();
    }

    private createParticles = (
        particlesPerHalf: number,
        random: () => number,
    ): SeededParticles => {
        const particleCount = particlesPerHalf * 2;
        const angles = new Float32Array(particleCount);
        const radialOffsets = new Float32Array(particleCount);
        const speeds = new Float32Array(particleCount);

        for (let index = 0; index < particleCount; index += 1) {
            const startAngle = index < particlesPerHalf ? Math.PI : 0;
            angles[index] = startAngle + random() * Math.PI;
            radialOffsets[index] = 0.9 + random() * 0.2;
            speeds[index] = 0.8 + random() * 0.4;
        }

        return {
            angles,
            radialOffsets,
            speeds,
        };
    }

    private createPositionBuffer = (particleCapacity: number): THREE.BufferAttribute => (
        new THREE.BufferAttribute(new Float32Array(particleCapacity * 3), 3)
            .setUsage(THREE.DynamicDrawUsage)
    );

    private createPoints = (
        position: THREE.BufferAttribute,
        opts: RingSystemOptions,
        z: number,
    ): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', position);
        const material = new THREE.PointsMaterial({
            color: opts.color,
            size: opts.particleSize ?? 2.5,
            sizeAttenuation: false,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
        });
        const points = new THREE.Points(geometry, material);
        points.position.set(this.center.x, this.center.y, z);
        points.frustumCulled = false;
        return points;
    }

    private updateGeometry = (): void => {
        this.back.position.set(this.center.x, this.center.y, this.z - 0.5);
        this.front.position.set(this.center.x, this.center.y, this.z + 0.5);
        this.repartitionParticles();

        this.navigationPosition.set(
            this.center.x + Math.cos(this.phase) * this.radiusX,
            this.center.y + Math.sin(this.phase) * this.radiusY,
        );
        this.navigationHitSize.set(
            Math.max(72, this.radiusX * 0.45),
            Math.max(32, this.radiusY * 0.75),
        );
    }

    private repartitionParticles = (): void => {
        const backPositions = this.backPosition.array as Float32Array;
        const frontPositions = this.frontPosition.array as Float32Array;
        let backCount = 0;
        let frontCount = 0;

        for (let index = 0; index < this.particles.angles.length; index += 1) {
            const angle = this.particles.angles[index] + this.phase * this.particles.speeds[index];
            const radialOffset = this.particles.radialOffsets[index];
            const frontHalf = this.isFrontHalf(angle);
            const positions = frontHalf ? frontPositions : backPositions;
            const positionIndex = (frontHalf ? frontCount++ : backCount++) * 3;
            positions[positionIndex] = Math.cos(angle) * this.radiusX * radialOffset;
            positions[positionIndex + 1] = Math.sin(angle) * this.radiusY * radialOffset;
            positions[positionIndex + 2] = 0;
        }

        this.back.geometry.setDrawRange(0, backCount);
        this.front.geometry.setDrawRange(0, frontCount);
        this.backPosition.needsUpdate = true;
        this.frontPosition.needsUpdate = true;
    }

    private isFrontHalf = (angle: number): boolean => {
        const normalizedAngle = ((angle % FULL_ORBIT) + FULL_ORBIT) % FULL_ORBIT;
        return normalizedAngle < Math.PI;
    }
}
