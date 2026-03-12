// sketch.js — trecho atualizado

import { GameManager }     from './GameManager.js';
import { LandingPage }     from './LandingPage.js';
import { Phase1, Phase2, Phase3 } from './Phases.js';

let gameManager;

window.setup = function () {
    createCanvas(windowWidth, windowHeight).parent('p5-container');

    gameManager = new GameManager();

    // Cenas de fluxo
    gameManager.addScene('landing',     new LandingPage());

    // Fases de jogo
    gameManager.addScene('phase1', new Phase1());
    gameManager.addScene('phase2', new Phase2());
    gameManager.addScene('phase3', new Phase3());

    // Conecta o botão da landing page
    const landing = gameManager.scenes.get('landing');
    if (landing) landing.onPlayClicked = () => gameManager.startGame();

    gameManager.init(); // sempre inicia na landing
    window.gameManager = gameManager;
};

document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM carregado, aguardando p5.js...');
  
  // Configura o botão de play
  const playButton = document.querySelector('.btn-play');
  if (playButton) {
    // Remove qualquer onclick anterior
    playButton.removeAttribute('onclick');
    
    // Adiciona event listener
    playButton.addEventListener('click', function() {
      console.log('Botão Jogar clicado');
      if (gameManager) {
        gameManager.startGame();
      } else {
        console.warn('Aguardando inicialização do jogo...');
      }
    });
    console.log('Event listener adicionado ao botão Jogar');
  }
  
  // Configura o botão de info
  const infoButton = document.querySelector('.btn-info');
  if (infoButton) {
    infoButton.addEventListener('click', function() {
      alert('Instruções do jogo:\n\n- Digite as palavras que aparecem na tela\n- Você tem 3 vidas\n- Cada fase tem um desafio diferente\n- Pressione B para conectar o ESP32 via Bluetooth\n- Pressione X para desconectar o Bluetooth\n- Pressione ESC para pausar');
    });
  }
});


/**
 * Configura todas as cenas do jogo
 */
function setupScenes() {
  // Landing Page
  const landingPage = new LandingPage();
  gameManager.addScene('landing', landingPage);

  // Fase Única
  const phase1 = new Phase1();
  gameManager.addScene('phase1', phase1);

  console.log('Cenas registradas: Landing Page + Fase Única');
}

/**
 * Conecta o botão da landing page com o game manager
 */
function connectLandingPageButton() {
  const landingPage = gameManager.scenes.get('landing');
  
  if (landingPage) {
    // Sobrescreve o método onPlayClicked
    landingPage.onPlayClicked = function() {
      console.log('Iniciando jogo via Landing Page');
      gameManager.startGame();
    };
  }
}

/**
 * Draw do p5.js - Loop principal
 */
window.draw = function() {
  // Delega o desenho para o game manager
  if (gameManager) {
    gameManager.update();
  }
};

/**
 * Callback de redimensionamento
 */
window.windowResized = function() {
  resizeCanvas(windowWidth, windowHeight);
  if (gameManager) {
    gameManager.handleResize();
  }
};

/**
 * Callback de mouse pressionado
 */
window.mousePressed = function() {
  if (gameManager) {
    gameManager.handleMousePressed();
  }
};

/**
 * Callback de tecla pressionada
 */
window.keyPressed = function() {
  if (gameManager) {
    gameManager.handleKeyPressed();
  }
};

console.log('📦 sketch.js módulo carregado');
