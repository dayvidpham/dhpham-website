import { Wave } from './Wave';
import { Sun, SunDrawProps, SunInitProps } from './Sun';
import { Drawable, Sequential, Point2D, ViewModel } from './Primitive';
import { CanvasControllerDrawables, CanvasController } from './CanvasController'
import { tryQueryDocument } from './Utils';

////////////////////////////////////////////////////
// Init Controller
////////////////////////////////////////////////////

enum InputIdentifier {
    SunColor = '#input-sun-color',
}

class UIController {
    readonly #mapInputToCallback: Map<InputIdentifier, string>;
    readonly #viewModel: ViewModel;
    readonly #canvasController: CanvasController

    constructor(
        mapInputToCallback: Map<InputIdentifier, string>,
        viewModel: ViewModel,
        canvasController: CanvasController
    ) {
        this.#mapInputToCallback = mapInputToCallback;
        this.#viewModel = viewModel;
        this.#canvasController = canvasController;
    }

    init() {
        this.#initUICallbacks();
    }

    #initUICallbacks = () => {
        const input = tryQueryDocument(InputIdentifier.SunColor, HTMLInputElement);
        input.addEventListener('input', this.#setSunColour);
    }

    #setSunColour = (event: Event): void => {
        // TODO: Performance bad on Chrome: maybe expose raw drawable?
        // Implement getProps on Drawable
        if (this.#viewModel.has('static.sun')) {
            const sunProps: { model: SunInitProps, draw: SunDrawProps } = this.#viewModel.get('static.sun');
            sunProps.draw.fillRgbHex = (event.currentTarget as HTMLInputElement).value;
            this.#canvasController.renderStatic();
        }
    }
}

const fps = 60;
const drawables: CanvasControllerDrawables = {
    static: {
        sun: [],
    },
    sequentials: {
        waves: [],
        bgWaves: [],
    }
}
const viewModel: ViewModel = new Map<string, Array<any>>();

const canvasController = new CanvasController(fps, drawables, viewModel);
canvasController.init();

// TODO: Turn this a Map<InputIdentifier, keyof UIControllerCallbacks>?
// WARN: This map could be unecessary and just overcomplicating things
// The UIController should configure how it hooks up its own callbacks?
const mapInputToCallback: Map<InputIdentifier, keyof UIController> = new Map();
const uiController = new UIController(mapInputToCallback, viewModel, canvasController);
uiController.init();

// setTimeout(controller.shutdown, 1 * 1000);
//controller.shutdown();
/*
You will refactor a Model-View-Controller (MVC) application to follow the Model-View-ViewModel (MVVM) architecture.
 */

