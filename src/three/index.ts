import * as THREE from 'three';
import { Sun } from './Sun';
import { Wave } from './Wave';

const canvas = document.getElementById('main-canvas') as HTMLCanvasElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#131313');

// Ortho camera with canvas-style coordinates: (0,0) top-left, y grows downward.
const camera = new THREE.OrthographicCamera(
    0, window.innerWidth,
    0, window.innerHeight,
    0.1, 100,
);
camera.position.z = 10;

const sun = new Sun({
    origin: new THREE.Vector2(window.innerWidth / 3, window.innerHeight / 2),
    radius: window.innerWidth / 7,
    minRadius: 100,
    maxRadius: 200,
    color: '#b8360f',
});
scene.add(sun.mesh);

const NUM_WAVES = 10;
const WAVE_NUM_ANCHOR_POINTS = 64;
const WAVE_Y_SIN_PERIOD_MS = (2 * Math.PI) / 3000;
const WAVE_Y_SIN_OFFSET = (Math.PI * 1.3) / NUM_WAVES;

const yOffset = window.innerHeight / (2 * NUM_WAVES);
const waves: Wave[] = [];
for (let i = 0; i < NUM_WAVES; i++) {
    const wave = new Wave({
        start: new THREE.Vector2(
            -10,
            window.innerHeight / 2 - (yOffset * NUM_WAVES) - (yOffset * i),
        ),
        end: new THREE.Vector2(
            window.innerWidth + 10,
            window.innerHeight / 2 + (0.25 * yOffset * NUM_WAVES) + (yOffset * i * 2),
        ),
        numPoints: WAVE_NUM_ANCHOR_POINTS,
        ySin: WAVE_Y_SIN_OFFSET * i,
        ySinPeriodMs: WAVE_Y_SIN_PERIOD_MS,
        yMagnitude: window.innerWidth * 0.1,
        minYMagnitude: 125,
        maxYMagnitude: 170,
        xJitter: 0,
        yJitter: 0,
        color: '#a0a0cc',
        opacity: 0x95 / 0xff,
    });
    waves.push(wave);
    scene.add(wave.line);
}

const initialDims = new THREE.Vector2(window.innerWidth, window.innerHeight);
window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = new THREE.Vector2(w / initialDims.x, h / initialDims.y);

    camera.right = w;
    camera.bottom = h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);

    sun.resize(scale);
    waves.forEach((wave) => wave.resize(scale));
});

let prevTimeMs = -1;
renderer.setAnimationLoop((timeMs: number) => {
    if (prevTimeMs === -1) prevTimeMs = timeMs;
    const deltaMs = timeMs - prevTimeMs;
    prevTimeMs = timeMs;

    waves.forEach((wave) => wave.update(deltaMs));
    renderer.render(scene, camera);
});
