import { GameManager } from './GameManager.js';
import { LandingPage } from './LandingPage.js';
import { Phase1, Phase2, Phase3 } from './Phases.js';

let gameManager;

window.setup = function () {
    createCanvas(windowWidth, windowHeight).parent('p5-container');

    gameManager = new GameManager();

    gameManager.addScene('landing', new LandingPage());
    gameManager.addScene('phase1', new Phase1());
    gameManager.addScene('phase2', new Phase2());
    gameManager.addScene('phase3', new Phase3());

    const landing = gameManager.scenes.get('landing');
    if (landing) {
        landing.onPlayClicked = () => gameManager.startGame();
    }

    gameManager.init();
    window.gameManager = gameManager;
};

window.draw = function () {
    if (gameManager) {
        gameManager.update();
    }
};

window.windowResized = function () {
    resizeCanvas(windowWidth, windowHeight);
    if (gameManager) {
        gameManager.handleResize();
    }
};

window.mousePressed = function () {
    if (gameManager) {
        gameManager.handleMousePressed();
    }
};

window.keyPressed = function () {
    if (gameManager) {
        gameManager.handleKeyPressed();
    }
};
