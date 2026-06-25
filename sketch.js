import { GameManager } from './GameManager.js';
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
    return () => {}; // unlisten no-op
}

// ============================================================================
// RECEBENDO COMANDOS DO DASHBOARD (substituiu o BroadcastChannel)
// ============================================================================
// ============================================================================
// RECEBENDO COMANDOS DO DASHBOARD
// ============================================================================
// Comandos de ciclo de vida do jogo — exclusivos do sketch.js.
// Os comandos de fase (PROXIMA_QUESTAO, SEGUNDA_CHANCE, etc.) são roteados
// diretamente pelo GameBridge.onCommand registrado em GamePhase._registrarHandlersBridge,
// evitando dupla execução e mantendo o guard de estado centralizado.
tauriListen('neurobeep_cmd', (event) => {
    const cmdType = event.payload?.type || event.payload?.command;
    console.log(`[sketch] Comando recebido: ${cmdType}`);

    switch (cmdType) {
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
            if (gameManager?.currentScene) gameManager.currentScene.pause?.();
            break;
        case 'CMD_RESUME_GAME':
            if (gameManager?.currentScene) gameManager.currentScene.resume?.();
            break;
    }
});



// ============================================================================
// SETUP p5.js
// ============================================================================
window.setup = function () {
    createCanvas(windowWidth, windowHeight).parent('p5-container');

    // Inicializa infraestrutura de tema e audio
    ThemeManager.init();
    AudioNarrator.init();

    // Esconde o overlay da landing page imediatamente —
    // o jogo não usa mais a tela de início interna.
    const overlay = document.querySelector('.content-overlay');
    if (overlay) overlay.style.display = 'none';

    gameManager = new GameManager();

    gameManager.addScene('phase1', new Phase1());
    gameManager.addScene('phase2', new Phase2());
    gameManager.addScene('phase3', new Phase3());

    // Inicia direto na fase 1 sem depender do dashboard Tauri
    gameManager.startGame();

    window.gameManager = gameManager;
};

// ============================================================================
// DRAW p5.js — loop principal
// ============================================================================
window.draw = function () {
    if (gameManager) {
        gameManager.update();
    }
};

// ============================================================================
// CALLBACKS p5.js
// ============================================================================
window.windowResized = function () {
    resizeCanvas(windowWidth, windowHeight);
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