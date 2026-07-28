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
};

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

    constructor(opts: NavigationAnchorOptions) {
        this.element = opts.element;
        this.route = opts.route;
        this.label = opts.label;
        this.element.setAttribute('href', this.route);
        this.element.textContent = this.label;
        this.sync(opts.worldPosition, opts.hitSize);
    }

    sync = (worldPosition: THREE.Vector2, hitSize: THREE.Vector2): void => {
        this.worldPosition.copy(worldPosition);
        this.hitSize.copy(hitSize);
        this.element.style.left = `${this.worldPosition.x}px`;
        this.element.style.top = `${this.worldPosition.y}px`;
        this.element.style.width = `${this.hitSize.x}px`;
        this.element.style.height = `${this.hitSize.y}px`;
    }
}
