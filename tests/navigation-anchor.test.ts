import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { NavigationAnchor, SiteRoute } from '../src/three/NavigationAnchor';

type FakeAnchor = {
    textContent: string | null;
    style: Record<string, string>;
    attributes: Map<string, string>;
    setAttribute: ReturnType<typeof vi.fn<(name: string, value: string) => void>>;
};

const createAnchor = (): FakeAnchor => {
    const attributes = new Map<string, string>();
    return {
        textContent: '',
        style: {},
        attributes,
        setAttribute: vi.fn((name: string, value: string) => attributes.set(name, value)),
    };
};

describe('NavigationAnchor', () => {
    it('keeps the native Blog href, label, and visual hit area synchronized', () => {
        const element = createAnchor();
        const anchor = new NavigationAnchor({
            element: element as unknown as HTMLAnchorElement,
            route: SiteRoute.Blog,
            label: 'blog',
            worldPosition: new THREE.Vector2(320, 240),
            hitSize: new THREE.Vector2(96, 40),
            viewport: { width: 800, height: 600 },
        });

        anchor.sync(new THREE.Vector2(400, 260), new THREE.Vector2(120, 48), {
            width: 800,
            height: 600,
        });

        expect(element.attributes.get('href')).toBe('/blog/');
        expect(element.textContent).toBe('blog');
        expect(element.style.left).toBe('400px');
        expect(element.style.top).toBe('260px');
        expect(element.style.width).toBe('120px');
        expect(element.style.height).toBe('48px');
        expect(anchor.route).toBe(SiteRoute.Blog);
        expect(anchor.worldPosition.toArray()).toEqual([400, 260]);
        expect(anchor.hitSize.toArray()).toEqual([120, 48]);
    });

    it('keeps the complete native hit area inside the viewport when the visual target reaches an edge', () => {
        const element = createAnchor();
        const anchor = new NavigationAnchor({
            element: element as unknown as HTMLAnchorElement,
            route: SiteRoute.Blog,
            label: 'blog',
            worldPosition: new THREE.Vector2(807, 620),
            hitSize: new THREE.Vector2(90, 48),
            viewport: { width: 800, height: 600 },
        });

        anchor.sync(new THREE.Vector2(426, -12), new THREE.Vector2(72, 48), {
            width: 390,
            height: 844,
        });

        expect(anchor.worldPosition.toArray()).toEqual([426, -12]);
        expect(anchor.hitSize.toArray()).toEqual([72, 48]);
        expect(anchor.screenPosition.toArray()).toEqual([354, 24]);
        expect(anchor.screenHitSize.toArray()).toEqual([72, 48]);
        expect(element.style.left).toBe('354px');
        expect(element.style.top).toBe('24px');
        expect(element.style.width).toBe('72px');
        expect(element.style.height).toBe('48px');
    });
});
