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
        });

        anchor.sync(new THREE.Vector2(400, 260), new THREE.Vector2(120, 48));

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
});
