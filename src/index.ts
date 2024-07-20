import { Wave } from './Wave';
import { Sun } from './Sun';
import { Drawable, Sequential, Point2D, ViewModel } from './Primitive';
import { CanvasControllerDrawables, CanvasController } from './CanvasController'
import { tryQueryDocument } from './Utils';

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
const viewModel: ViewModel = new Map<string, Array<any>>();

const canvasController = new CanvasController(fps, drawables, viewModel);
canvasController.init();

// setTimeout(controller.shutdown, 1 * 1000);
//controller.shutdown();

