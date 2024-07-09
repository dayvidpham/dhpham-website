import { rand2DNormed, lerp, rand3DNormed, clamp } from "./Utils";

const GRID_LEN: number = 256;
const NUM_DIMS: number = 3;

const permutation: readonly number[] = [
    // Hash lookup table as defined by Ken Perlin.
    // This is a randomly arranged array of all numbers from 0-255 inclusive.
    151, 160, 137, 91, 90, 15,
    131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23,
    190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33,
    88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166,
    77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244,
    102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196,
    135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124, 123,
    5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42,
    223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9,
    129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228,
    251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107,
    49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254,
    138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180
];
const p: readonly number[] = [
    // Double to avoid overflow when doing operations like
    // p[p[X] + Y]
    ...permutation,
    ...permutation
]

const initGradients = (NUM_DIMS: number, GRID_LEN: number) => {
    let gradients: Float32Array = new Float32Array(GRID_LEN * NUM_DIMS);
    const HALF_PI = Math.PI / 2;
    const TWO_PI = 2 * Math.PI;
    for (let i = 0; i < GRID_LEN; i++) {
        let azimuthalAngle = TWO_PI * Math.random();
        let polarAngle = Math.acos(clamp(
            2 * Math.random() - 1,
            -1 + 1e-12,
            1 - 1e-12
        )) - HALF_PI;
        // To [x, y, z]
        gradients[i * 3] = Math.cos(polarAngle) * Math.cos(azimuthalAngle)
        gradients[i * 3 + 1] = Math.cos(polarAngle) * Math.sin(azimuthalAngle)
        gradients[i * 3 + 2] = Math.sin(polarAngle)
    }
    return gradients;
}
const gradients: Float32Array = initGradients(NUM_DIMS, GRID_LEN);

/* indexGrid(x: number, y: number, z: number) {
    return [
        Math.floor(x) & 255,
        Math.floor(y) & 255,
        Math.floor(z) & 255,
    ];
} */

const fade = (t: number) =>
    // quintic hermitian spline: 1st and 2nd derivs are 0 at ends
    t * t * t * (10 - 15 * t + 6 * t * t)

const indexGrid = (p: number) => Math.floor(p) & 255;

const indexGradient = (xi: number, yi: number, zi: number) => {
    return p[p[p[xi] + yi] + zi] * 3;
}

const internalPoint = (pn: number) => pn - Math.floor(pn);

const displacements = (x: number, y: number, z: number) => {
    // Compute displacement vector to each 2**n grid vertex
}

const dot = (gx: number, gy: number, gz: number, dx: number, dy: number, dz: number) => {
    // dot product of each displacement vector with their respective gradient
    return gx * dx + gy * dy + gz * dz
}

export const noise = (x: number, y: number, z: number) => {
    const pointP: readonly number[] = [x, y, z];
    const gridP0: readonly number[] = pointP.map(indexGrid);
    const gridP1: readonly number[] = gridP0.map(xin => indexGrid(xin + 1));

    const cubeP: readonly number[] = pointP.map(internalPoint);
    const faded: readonly number[] = cubeP.map(fade);

    const gridPX = [gridP0[0], gridP1[0]];
    const gridPY = [gridP0[1], gridP1[1]];
    const gridPZ = [gridP0[2], gridP1[2]];
    let ig: number = 0;
    let gridX: number = 0, gridY: number = 0, gridZ: number = 0;
    let gradX: number = 0, gradY: number = 0, gradZ: number = 0;
    let dots: Float32Array = new Float32Array(8);

    // eight corners of a cube
    //
    //    011         111
    //     o___________o
    //    / |          /|
    //   /  |         / |
    // 010  |       110 |
    //  o____________o  |
    //  |   |        |  |
    //  |  o|        |_o|
    //  | 001--------|101
    //  | /          | /
    //  |/           |/
    //  o____________o
    // 000          100

    for (let igz = 0; igz < 2; igz++) {
        for (let igy = 0; igy < 2; igy++) {
            for (let igx = 0; igx < 2; igx++) {
                // Corner is given by (xin[xii], yin[yii], zin[zii])
                gridX = gridPX[igx];
                gridY = gridPY[igy];
                gridZ = gridPZ[igz];

                ig = indexGradient(gridX, gridY, gridZ);
                gradX = gradients[ig];
                gradY = gradients[ig + 1];
                gradZ = gradients[ig + 2];

                // Relative to cubeP, vertex 000 is the origin.
                // Call this the internal cube coords, where 
                // corner 111 would be then be vector (1, 1, 1), w.r.t. to vertex 000.
                //
                // Then displacement vector (cubeP - vertex<___>) will just be
                // -1 applied on the appropriate axes.
                //
                // Can use the for loop indices to apply appropriate displacement.
                dots[igx + igy * 2 + igz * 4] =
                    gradX * (cubeP[0] - igx)
                    + gradY * (cubeP[1] - igy)
                    + gradZ * (cubeP[2] - igz);
            }
        }
    }

    let x_00 = lerp(dots[0], dots[1], faded[0]),
        x_10 = lerp(dots[2], dots[3], faded[0]),
        y__0 = lerp(x_00, x_10, faded[1]);

    let x_01 = lerp(dots[4], dots[5], faded[0]),
        x_11 = lerp(dots[6], dots[7], faded[0]),
        y__1 = lerp(x_01, x_11, faded[1]);

    let output = (lerp(y__0, y__1, faded[2]) + 1) / 2;
    return output;
}

/* static indexGradient(x: number, y: number, z: number) {
    const xi = Perlin.indexGrid(x),
        yi = Perlin.indexGrid(y),
        zi = Perlin.indexGrid(z);
    const aaa = permutation[permutation[permutation[xi] + yi] + zi],
        aba = permutation[permutation[permutation[xi] + yi + 1] + zi],
        aab = permutation[permutation[permutation[xi] + yi] + zi + 1],
        abb = permutation[permutation[permutation[xi] + yi + 1] + zi + 1],
        baa = permutation[permutation[permutation[xi + 1] + yi] + zi],
        bba = permutation[permutation[permutation[xi + 1] + yi + 1] + zi],
        bab = permutation[permutation[permutation[xi + 1] + yi] + zi + 1],
        bbb = permutation[permutation[permutation[xi + 1] + yi + 1] + zi + 1]
} */

