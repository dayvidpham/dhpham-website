import * as THREE from 'three';

export enum SiteRoute {
    Blog = '/blog/',
}

export type NavigationAnchorOptions = {
    element: HTMLAnchorElement;
    route: SiteRoute;
    label: string;
    worldPosition: THREE.Vector2;
    hitSize: THREE.Vector2;
    viewport: NavigationViewport;
};

export type NavigationViewport = Readonly<{
    width: number;
    height: number;
}>;

/**
 * The native link is the sole owner of navigation. Three.js supplies only the
 * world-space placement for its visual target.
 */
export class NavigationAnchor {
    readonly element: HTMLAnchorElement;
    readonly route: SiteRoute;
    readonly label: string;
    readonly worldPosition = new THREE.Vector2();
    readonly hitSize = new THREE.Vector2();
    readonly screenPosition = new THREE.Vector2();
    readonly screenHitSize = new THREE.Vector2();

    constructor(opts: NavigationAnchorOptions) {
        this.element = opts.element;
        this.route = opts.route;
        this.label = opts.label;
        this.element.setAttribute('href', this.route);
        this.element.textContent = this.label;
        this.sync(opts.worldPosition, opts.hitSize, opts.viewport);
    }

    sync = (
        worldPosition: THREE.Vector2,
        hitSize: THREE.Vector2,
        viewport: NavigationViewport,
    ): void => {
        this.worldPosition.copy(worldPosition);
        this.hitSize.copy(hitSize);
        this.screenHitSize.set(
            Math.min(this.hitSize.x, viewport.width),
            Math.min(this.hitSize.y, viewport.height),
        );
        this.screenPosition.set(
            this.clampToViewport(this.worldPosition.x, this.screenHitSize.x, viewport.width),
            this.clampToViewport(this.worldPosition.y, this.screenHitSize.y, viewport.height),
        );
        this.element.style.left = `${this.screenPosition.x}px`;
        this.element.style.top = `${this.screenPosition.y}px`;
        this.element.style.width = `${this.screenHitSize.x}px`;
        this.element.style.height = `${this.screenHitSize.y}px`;
    }

    private clampToViewport = (position: number, size: number, limit: number): number => {
        const halfSize = size / 2;
        return Math.min(Math.max(position, halfSize), limit - halfSize);
    }
}
