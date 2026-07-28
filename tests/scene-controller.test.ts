import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SceneController, SceneRenderer, Viewport } from '../src/three/SceneController';

class FakeRenderer implements SceneRenderer {
    pixelRatios: number[] = [];
    sizes: Array<[number, number]> = [];
    render = vi.fn<(scene: THREE.Scene, camera: THREE.Camera) => void>();
    dispose = vi.fn<() => void>();

    setClearColor = vi.fn<(color: THREE.ColorRepresentation, alpha?: number) => void>();

    setPixelRatio = (pixelRatio: number): void => {
        this.pixelRatios.push(pixelRatio);
    };

    setSize = (width: number, height: number): void => {
        this.sizes.push([width, height]);
    };

}

const createAnchor = (): HTMLAnchorElement => ({
    textContent: '',
    style: {},
    setAttribute: vi.fn(),
} as unknown as HTMLAnchorElement);

const createResizeTarget = () => {
    const listeners = new Set<() => void>();
    return {
        listeners,
        addEventListener: vi.fn((_type: 'resize', listener: () => void) => listeners.add(listener)),
        removeEventListener: vi.fn((_type: 'resize', listener: () => void) => listeners.delete(listener)),
    };
};

const createAnimationScheduler = () => {
    const callbacks = new Map<number, (timeMs: number) => void>();
    let requestId = 0;
    return {
        callbacks,
        requestAnimationFrame: vi.fn((callback: (timeMs: number) => void) => {
            requestId += 1;
            callbacks.set(requestId, callback);
            return requestId;
        }),
        cancelAnimationFrame: vi.fn((id: number) => callbacks.delete(id)),
        renderNextFrame: (timeMs: number) => {
            const frame = callbacks.entries().next().value as
                | [number, (nextTimeMs: number) => void]
                | undefined;
            if (!frame) return;
            callbacks.delete(frame[0]);
            frame[1](timeMs);
        },
    };
};

describe('SceneController', () => {
    it('owns the Y-down scene lifecycle, resize listener, animation, anchor, and resources', () => {
        const renderer = new FakeRenderer();
        const resizeTarget = createResizeTarget();
        const animationScheduler = createAnimationScheduler();
        const navigationElement = createAnchor();
        let viewport: Viewport = { width: 800, height: 600 };
        const controller = new SceneController({
            canvas: {} as HTMLCanvasElement,
            navigationElement,
            renderer,
            getViewport: () => viewport,
            getDevicePixelRatio: () => 3,
            resizeTarget,
            animationScheduler,
        });
        const sunGeometryDispose = vi.spyOn(controller.sun.mesh.geometry, 'dispose');
        const planetGeometryDispose = vi.spyOn(controller.planet.mesh.geometry, 'dispose');
        const ringBackGeometryDispose = vi.spyOn(controller.rings.back.geometry, 'dispose');
        const ringFrontGeometryDispose = vi.spyOn(controller.rings.front.geometry, 'dispose');
        const initialTarget = controller.navigationAnchor.worldPosition.clone();

        controller.start();
        controller.start();
        animationScheduler.renderNextFrame(100);
        animationScheduler.renderNextFrame(160);
        viewport = { width: 400, height: 300 };
        resizeTarget.listeners.forEach((listener) => listener());
        controller.resize({ width: 800, height: 600 });

        expect(controller.camera.left).toBe(0);
        expect(controller.camera.top).toBe(0);
        expect(controller.camera.right).toBe(800);
        expect(controller.camera.bottom).toBe(600);
        expect(renderer.pixelRatios.every((ratio) => ratio === 2)).toBe(true);
        expect(renderer.sizes.at(-1)).toEqual([800, 600]);
        expect(resizeTarget.listeners.size).toBe(1);
        expect(controller.scene.children.filter((child) => child instanceof THREE.Points)).toHaveLength(2);
        expect(controller.rings.back.position.z).toBeLessThan(controller.planet.mesh.position.z);
        expect(controller.rings.front.position.z).toBeGreaterThan(controller.planet.mesh.position.z);
        expect(controller.navigationAnchor.worldPosition).not.toEqual(initialTarget);
        expect(navigationElement.style.left).toBe(`${controller.navigationAnchor.worldPosition.x}px`);
        expect(renderer.render).toHaveBeenCalledTimes(3);

        controller.stop();
        expect(animationScheduler.callbacks.size).toBe(0);
        expect(resizeTarget.listeners.size).toBe(0);

        controller.dispose();
        controller.dispose();

        expect(sunGeometryDispose).toHaveBeenCalledOnce();
        expect(planetGeometryDispose).toHaveBeenCalledOnce();
        expect(ringBackGeometryDispose).toHaveBeenCalledOnce();
        expect(ringFrontGeometryDispose).toHaveBeenCalledOnce();
        expect(renderer.dispose).toHaveBeenCalledOnce();
        expect(controller.scene.children).toHaveLength(0);
    });
});
