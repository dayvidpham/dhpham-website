import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Planet } from '../src/three/Planet';
import { RingSystem } from '../src/three/RingSystem';
import { Sun } from '../src/three/Sun';
import { Wave } from '../src/three/Wave';

describe('Three.js scene object lifecycles', () => {
    it('constructs, resizes, attaches, and disposes a sun', () => {
        const sun = new Sun({
            origin: new THREE.Vector2(100, 200),
            radius: 50,
            minRadius: 25,
            maxRadius: 100,
            color: '#b8360f',
            segments: 8,
        });
        const scene = new THREE.Scene();
        const geometryDispose = vi.spyOn(sun.mesh.geometry, 'dispose');
        const materialDispose = vi.spyOn(sun.mesh.material, 'dispose');

        scene.add(sun.mesh);
        sun.resize(new THREE.Vector2(2, 0.5));
        sun.resize(new THREE.Vector2(1, 1));
        sun.dispose();

        expect(scene.children).toContain(sun.mesh);
        expect(sun.mesh.position.toArray()).toEqual([100, 200, 0]);
        expect(sun.mesh.scale.toArray()).toEqual([1, 1, 1]);
        expect(geometryDispose).toHaveBeenCalledOnce();
        expect(materialDispose).toHaveBeenCalledOnce();
    });

    it('constructs, updates, resizes, attaches, and disposes a wave', () => {
        const wave = new Wave({
            start: new THREE.Vector2(0, 10),
            end: new THREE.Vector2(100, 20),
            numPoints: 4,
            ySin: 0,
            ySinPeriodMs: Math.PI / 3000,
            yMagnitude: 25,
            minYMagnitude: 10,
            maxYMagnitude: 50,
            xJitter: 0,
            yJitter: 0,
            color: '#a0a0cc',
            opacity: 0.5,
        });
        const scene = new THREE.Scene();
        const position = wave.line.geometry.getAttribute('position');
        const geometryDispose = vi.spyOn(wave.line.geometry, 'dispose');
        const materialDispose = vi.spyOn(wave.line.material, 'dispose');

        scene.add(wave.line);
        wave.update(16);
        const initialPositions = Array.from(position.array);
        wave.resize(new THREE.Vector2(2, 0.5));
        wave.resize(new THREE.Vector2(1, 1));
        wave.update(0);
        wave.dispose();

        expect(scene.children).toContain(wave.line);
        expect(position.count).toBe(4);
        expect(position.usage).toBe(THREE.DynamicDrawUsage);
        expect(position.version).toBeGreaterThan(0);
        expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
        expect(Array.from(position.array)).toEqual(initialPositions);
        expect(wave.line.frustumCulled).toBe(false);
        expect(geometryDispose).toHaveBeenCalledOnce();
        expect(materialDispose).toHaveBeenCalledOnce();
    });

    it('applies a typed Sun distortion to a wave without creating invalid vertices', () => {
        const createWave = (sunDistortion?: { origin: THREE.Vector2; radius: number; strength: number }) => new Wave({
            start: new THREE.Vector2(0, 40),
            end: new THREE.Vector2(160, 40),
            numPoints: 8,
            ySin: 0,
            ySinPeriodMs: 0,
            yMagnitude: 0,
            minYMagnitude: 0,
            maxYMagnitude: 1,
            xJitter: 0,
            yJitter: 0,
            color: '#a0a0cc',
            opacity: 1,
            sunDistortion,
        });
        const undistorted = createWave();
        const distorted = createWave({
            origin: new THREE.Vector2(80, 40),
            radius: 80,
            strength: 0.5,
        });

        undistorted.update(0);
        distorted.update(0);
        const undistortedPositions = Array.from(undistorted.line.geometry.getAttribute('position').array);
        const distortedPositions = Array.from(distorted.line.geometry.getAttribute('position').array);

        expect(distortedPositions).not.toEqual(undistortedPositions);
        expect(distortedPositions.every(Number.isFinite)).toBe(true);
        undistorted.dispose();
        distorted.dispose();
    });

    it('constructs a foreground planet and exactly two deterministic orbiting particle halves', () => {
        const planet = new Planet({
            origin: new THREE.Vector2(300, 220),
            radius: 80,
            minRadius: 40,
            maxRadius: 120,
            color: '#484776',
        });
        const createRings = () => new RingSystem({
            center: planet.worldPosition,
            radiusX: 140,
            radiusY: 42,
            z: planet.mesh.position.z,
            color: '#d1d1ee',
            particlesPerHalf: 8,
            seed: 23,
        });
        const rings = createRings();
        const duplicate = createRings();
        const scene = new THREE.Scene();
        const backGeometryDispose = vi.spyOn(rings.back.geometry, 'dispose');
        const frontGeometryDispose = vi.spyOn(rings.front.geometry, 'dispose');
        const backMaterialDispose = vi.spyOn(rings.back.material, 'dispose');
        const frontMaterialDispose = vi.spyOn(rings.front.material, 'dispose');
        const initialBackPositions = Array.from(rings.back.geometry.getAttribute('position').array);
        const initialTarget = rings.navigationPosition.clone();

        scene.add(planet.mesh, rings.back, rings.front);
        rings.update(120);
        rings.resize(new THREE.Vector2(2, 0.5));

        expect(scene.children.filter((child) => child instanceof THREE.Points)).toHaveLength(2);
        expect(rings.back.geometry.getAttribute('position').count).toBe(8);
        expect(rings.front.geometry.getAttribute('position').count).toBe(8);
        expect(initialBackPositions).toEqual(
            Array.from(duplicate.back.geometry.getAttribute('position').array),
        );
        expect(Array.from(rings.back.geometry.getAttribute('position').array)).not.toEqual(initialBackPositions);
        expect(rings.back.position.z).toBeLessThan(planet.mesh.position.z);
        expect(rings.front.position.z).toBeGreaterThan(planet.mesh.position.z);
        expect(rings.navigationPosition).not.toEqual(initialTarget);
        expect(rings.navigationHitSize.x).toBeGreaterThanOrEqual(72);

        rings.dispose();
        rings.dispose();
        duplicate.dispose();
        planet.dispose();

        expect(backGeometryDispose).toHaveBeenCalledOnce();
        expect(frontGeometryDispose).toHaveBeenCalledOnce();
        expect(backMaterialDispose).toHaveBeenCalledOnce();
        expect(frontMaterialDispose).toHaveBeenCalledOnce();
    });
});
