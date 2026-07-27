import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
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
});
