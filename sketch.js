import { GameManager } from './GameManager.js';
import { LandingPage } from './LandingPage.js';
import { Phase1, Phase2, Phase3 } from './Phases.js';
import { ThemeManager } from './ThemeManager.js';
import { AudioNarrator } from './AudioNarrator.js';

let gameManager;

// ============================================================================
// HELPER: Ponte com o Dashboard React via eventos Tauri
// Substitui o BroadcastChannel, que não atravessa WebviewWindows distintas.
// ============================================================================
async function tauriEmit(eventName, payload) {
    try {
        if (window.__TAURI__?.event?.emit) {
            await window.__TAURI__.event.emit(eventName, payload);
        }
    } catch (e) {
        console.warn('[sketch] tauriEmit falhou:', e);
    }
}

async function tauriListen(eventName, handler) {
    try {
        if (window.__TAURI__?.event?.listen) {
            return await window.__TAURI__.event.listen(eventName, handler);
        }
    } catch (e) {
        console.warn('[sketch] tauriListen falhou:', e);
    }
    return () => {};
}

// ============================================================================
// RECEBENDO COMANDOS DO DASHBOARD
// ============================================================================
tauriListen('neurobeep_cmd', (event) => {
    const { type, payload } = event.payload ?? {};
    console.log(`[sketch] Comando recebido: ${type}`, payload);

    switch (type) {
        case 'CMD_START_GAME': {
            const overlay = document.querySelector('.content-overlay');
            if (overlay) overlay.style.display = 'none';
            if (gameManager) {
                console.log('▶️ Iniciando jogo via Dashboard');
                gameManager.startGame();
            }
            break;
        }
        case 'CMD_PAUSE_GAME':
            if (gameManager) gameManager.isPaused = true;
            break;
        case 'CMD_RESUME_GAME':
            if (gameManager) gameManager.isPaused = false;
            break;
        case 'CMD_NEXT_QUESTION': {
            const currentScene = gameManager?.currentScene;
            if (currentScene && typeof currentScene._avancarQuestao === 'function') {
                currentScene._avancarQuestao(payload?.questionIndex);
            }
            break;
        }
    }
});

// ============================================================================
// CAPTURA DE FRAMES PARA A MINIATURA DO DASHBOARD
// ============================================================================
let _frameCounter = 0;
let _canvas = null;

function _enviarFrameMiniatura() {
    _frameCounter += 1;
    if (_frameCounter % 4 !== 0) return;

    const diagnostico = _frameCounter % 240 === 0;

    try {
        if (!_canvas) _canvas = document.querySelector('canvas');

        if (diagnostico) {
            console.log('[sketch] _enviarFrameMiniatura tick:', {
                canvas: !!_canvas,
                tauriDisponivel: !!window.__TAURI__?.event?.emit,
                frameCounter: _frameCounter,
            });
        }

        if (!_canvas) return;

        const frame = _canvas.toDataURL('image/jpeg', 0.5);
        tauriEmit('neurobeep_frame', { frame });

        if (diagnostico) {
            console.log('[sketch] Frame emitido, tamanho base64:', frame.length, 'chars');
        }
    } catch (err) {
        console.warn('[sketch] _enviarFrameMiniatura erro:', err);
    }
}

// ============================================================================
// SETUP p5.js
// ============================================================================
window.setup = function () {
    createCanvas(windowWidth, windowHeight).parent('p5-container');

    ThemeManager.init();
    AudioNarrator.init();

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

// ============================================================================
// DRAW p5.js — loop principal
// ============================================================================
window.draw = function () {
    if (gameManager) {
        gameManager.update();
    }

    _enviarFrameMiniatura();
};

// ============================================================================
// CALLBACKS p5.js
// ============================================================================
window.windowResized = function () {
    resizeCanvas(windowWidth, windowHeight);
    _canvas = null;
    if (gameManager) gameManager.handleResize();
};

window.mousePressed = function () {
    if (gameManager) gameManager.handleMousePressed();
};

window.keyPressed = function () {
    if (gameManager) gameManager.handleKeyPressed();
};

// ============================================================================
// DOM: botões HTML (fallback de segurança)
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    const playButton = document.querySelector('.btn-play');
    if (playButton) {
        playButton.removeAttribute('onclick');
        playButton.addEventListener('click', () => {
            if (gameManager) gameManager.startGame();
        });
    }

    const infoButton = document.querySelector('.btn-info');
    if (infoButton) {
        infoButton.addEventListener('click', () => {
            alert(
                'Instruções:\n\n' +
                '- ESPAÇO = mover/parar o robô\n' +
                '- ← → = mudar direção\n' +
                '- B = conectar ESP32 Bluetooth\n' +
                '- X = desconectar Bluetooth\n' +
                '- ESC = pausar'
            );
        });
    }
});

console.log('[sketch] Módulo carregado com suporte Tauri.');
