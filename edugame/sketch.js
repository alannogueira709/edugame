/**
 * sketch.js - Arquivo principal do jogo
 * SOLUÇÃO: Adiciona event listeners via JavaScript ao invés de usar onclick no HTML
 */

import { GameManager } from './GameManager.js';
import { LandingPage } from './LandingPage.js';
import { Phase1, Phase2, Phase3 } from './Phases.js';

// Variável global do gerenciador de jogo
let gameManager;

/**
 * Aguarda o DOM estar pronto e configura os botões
 */
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
      alert('Instruções do jogo:\n\n- Digite as palavras que aparecem na tela\n- Você tem 3 vidas\n- Cada fase tem um desafio diferente\n- Pressione ESC para pausar');
    });
  }
});

/**
 * Setup do p5.js - Inicialização
 */
window.setup = function() {
  console.log('p5.js setup iniciado');
  
  // Cria canvas
  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent('p5-container');

  // Inicializa o gerenciador de jogo
  gameManager = new GameManager();

  // Cria e registra todas as cenas
  setupScenes();

  // Conecta o botão play da landing page com o game manager
  connectLandingPageButton();

  // Inicia na landing page
  gameManager.init('landing');

  // Expõe o gameManager globalmente
  window.gameManager = gameManager;

  console.log('✅ p5.js setup completo - Jogo pronto!');
};

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