import { Scene } from './Scene.js';
import { Text } from './libs/letters.js';

/**
 * Classe base GamePhase - Representa uma fase do jogo
 * Herda de Scene e adiciona funcionalidades específicas de gameplay
 */
export class GamePhase extends Scene {
    constructor(name, phaseNumber) {
        super(name);
        this.phaseNumber = phaseNumber;
        this.score = 0;
        this.lives = 3;
        this.isPaused = false;
        this.textInstance = null;
        this.sprites = [];
        this.gameUI = null;
    }

    setup() {
        super.setup();
        this.createGameUI();
        this.initializePhase();
    }

    createGameUI() {
        // Remove overlay da landing page se existir
        const overlay = document.querySelector('.content-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }

        // Cria container para UI do jogo
        this.gameUI = document.createElement('div');
        this.gameUI.className = 'game-ui';
        this.gameUI.innerHTML = `
            <div class="game-header">
                <div class="score">Pontuação: <span id="score-value">0</span></div>
                <div class="phase">Fase: <span id="phase-value">${this.phaseNumber}</span></div>
                <div class="lives">Vidas: <span id="lives-value">${this.lives}</span></div>
            </div>
        `;
        document.body.appendChild(this.gameUI);
        this.elements.push(this.gameUI);
    }

    initializePhase() {
        console.log(`Initializing phase ${this.phaseNumber}`);
    }

    draw() {
        if (!this.isActive || this.isPaused) return;

        background(46, 153, 191);

        this.updateSprites();
        this.drawSprites();
        this.updateUI();
        this.checkGameState();
    }

    updateSprites() {
        // Implementação base
    }

    drawSprites() {
        if (this.sprites.length > 0) {
            const startX = 40;
            const y = height / 2 - 32;
            
            this.sprites.forEach((letterObj, i) => {
                if (letterObj.image) {
                    image(letterObj.image, startX + i * 72, y);
                }
            });
        }
    }

    updateUI() {
        const scoreElement = document.getElementById('score-value');
        const livesElement = document.getElementById('lives-value');
        
        if (scoreElement) scoreElement.textContent = this.score;
        if (livesElement) livesElement.textContent = this.lives;
    }

    checkGameState() {
        if (this.lives <= 0) {
            this.onGameOver();
        }
    }

    // Processamento de texto para as sprites
    async processText(userText) {
        if (userText.trim() === '') {
            console.warn('Digite algo!');
            return;
        }
        
        this.textInstance = new Text(userText);
        // NOTA: Aqui estamos assumindo que o GamePhase genérico 
        // usa o array de sprites de forma simples.
        // As classes filhas (GamePhase1) sobrescrevem isso.
        const loadedLetters = await this.textInstance.loadAllImages();
        
        // Extrai apenas as imagens para o array de sprites base
        this.sprites = loadedLetters.map(l => ({ image: l.image }));
        
        console.log(`Texto "${userText}" processado!`);
    }

    addScore(points) {
        this.score += points;
    }

    loseLife() {
        this.lives--;
        console.log(`Vida perdida! Vidas restantes: ${this.lives}`);
    }

    pause() {
        this.isPaused = true;
        console.log('Jogo pausado');
    }

    resume() {
        this.isPaused = false;
        console.log('Jogo retomado');
    }

    onGameOver() {
        console.log('Game Over!');
        this.pause();
    }

    onPhaseComplete() {
        console.log(`Fase ${this.phaseNumber} completa!`);
    }

    cleanup() {
        super.cleanup();
        if (this.gameUI && this.gameUI.parentNode) {
            this.gameUI.parentNode.removeChild(this.gameUI);
        }
        this.sprites = [];
        this.textInstance = null;
    }

    handleKeyPressed() {
        if (keyCode === 27) { // ESC
            this.isPaused ? this.resume() : this.pause();
        }
    }
}