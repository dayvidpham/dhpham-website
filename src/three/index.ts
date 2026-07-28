import { SceneController } from './SceneController';

const getRequiredElement = <ElementType extends HTMLElement>(
    id: string,
    expectedTag: string,
): ElementType => {
    const element = document.getElementById(id);
    if (!element || element.tagName !== expectedTag) {
        throw new Error(
            `Home scene startup failed: expected ${expectedTag.toLowerCase()}#${id} `
            + 'in index.html before starting the celestial scene.',
        );
    }
    return element as ElementType;
};

const canvas = getRequiredElement<HTMLCanvasElement>('main-canvas', 'CANVAS');
const navigationElement = getRequiredElement<HTMLAnchorElement>('blog-navigation', 'A');

new SceneController({ canvas, navigationElement }).start();
