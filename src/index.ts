import { Wave } from './Wave';
import { Sun } from './Sun';
import { Drawable, Sequential, Point2D } from './Primitive';
import { CanvasController, CanvasControllerDrawables } from './CanvasController'

////////////////////////////////////////////////////
// Init Controller
////////////////////////////////////////////////////

const fps = 60;

const drawables: CanvasControllerDrawables = {
    static: [],
    sequentials: {
        waves: [],
        bgWaves: [],
    }
}

const controller = new CanvasController(fps, drawables);
controller.init();

// setTimeout(controller.shutdown, 1 * 1000);
//controller.shutdown();

