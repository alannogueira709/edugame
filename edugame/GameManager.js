/**
 * GameManager - Gerenciador central do jogo
 * Responsável por:
 * - Gerenciar todas as cenas (LandingPage, Fases, GameOver, etc)
 * - Controlar transições entre cenas
 * - Manter estado global do jogo
 */
export class GameManager {
    constructor() {
        this.scenes = new Map();
        this.currentScene = null;
        this.gameState = {
            totalScore: 0,
            currentPhase: 0,
            highScore: this.loadHighScore()
        };
    }

    /**
     * Registra uma nova cena no gerenciador
     */
    addScene(key, scene) {
        this.scenes.set(key, scene);
        console.log(`Scene registered: ${key}`);
    }

    /**
     * Inicializa o gerenciador com a cena inicial
     */
    init(initialSceneKey) {
        console.log('GameManager initialized');
        this.switchTo(initialSceneKey);
    }

    /**
     * Troca para uma nova cena
     */
    switchTo(sceneKey, options = {}) {
        const nextScene = this.scenes.get(sceneKey);
        
        if (!nextScene) {
            console.error(`Scene not found: ${sceneKey}`);
            return;
        }

        // Sai da cena atual
        if (this.currentScene) {
            this.currentScene.exit();
            this.currentScene.cleanup();
        }

        // Entra na nova cena
        this.currentScene = nextScene;
        this.currentScene.setup();
        this.currentScene.enter();

        // Aplica opções específicas
        if (options.onComplete) {
            this.currentScene.onPhaseComplete = () => options.onComplete();
        }
        if (options.onGameOver) {
            this.currentScene.onGameOver = () => options.onGameOver();
        }

        console.log(`Switched to scene: ${sceneKey}`);
    }

    /**
     * Inicia o jogo a partir da landing page
     */
    startGame() {
        console.log('Starting game...');
        this.gameState.currentPhase = 1;
        this.gameState.totalScore = 0;
        this.goToPhase(1);
    }

    /**
     * Vai para uma fase específica
     */
    goToPhase(phaseNumber) {
        const phaseKey = `phase${phaseNumber}`;
        
        if (!this.scenes.has(phaseKey)) {
            console.log('Game completed! Showing victory screen...');
            this.showVictory();
            return;
        }

        this.gameState.currentPhase = phaseNumber;
        
        this.switchTo(phaseKey, {
            onPhaseComplete: () => this.onPhaseComplete(phaseNumber),
            onGameOver: () => this.onGameOver()
        });
    }

    /**
     * Callback quando uma fase é completada
     */
    onPhaseComplete(phaseNumber) {
        const completedPhase = this.scenes.get(`phase${phaseNumber}`);
        
        if (completedPhase) {
            // Acumula pontuação
            this.gameState.totalScore += completedPhase.score;
            console.log(`Round completed! Total score: ${this.gameState.totalScore}`);
        }

        // Volta para a mesma fase (game loop)
        this.goToPhase(1);
    }

    /**
     * Callback de game over
     */
    onGameOver() {
        console.log('Game Over!');
        
        // Atualiza high score se necessário
        if (this.gameState.totalScore > this.gameState.highScore) {
            this.gameState.highScore = this.gameState.totalScore;
            this.saveHighScore(this.gameState.highScore);
        }

        // Mostra tela de game over
        this.showGameOver();
    }

    /**
     * Mostra tela de game over
     */
    showGameOver() {
        // Cria uma tela de game over simples
        const gameOverDiv = document.createElement('div');
        gameOverDiv.className = 'game-over-screen';
        gameOverDiv.innerHTML = `
            <div class="game-over-content">
                <h1>Game Over!</h1>
                <p>Pontuação Final: ${this.gameState.totalScore}</p>
                <p>Recorde: ${this.gameState.highScore}</p>
                <button class="btn-play" onclick="gameManager.restartGame()">
                    Jogar Novamente
                </button>
                <button class="btn-info" onclick="gameManager.goToLanding()">
                    Menu Principal
                </button>
            </div>
        `;
        document.body.appendChild(gameOverDiv);

        // Adiciona estilo
        this.addGameOverStyles();
    }

    /**
     * Mostra tela de vitória
     */
    showVictory() {
        const victoryDiv = document.createElement('div');
        victoryDiv.className = 'victory-screen';
        victoryDiv.innerHTML = `
            <div class="victory-content">
                <h1>🎉 Parabéns! 🎉</h1>
                <p>Você completou todas as fases!</p>
                <p>Pontuação Total: ${this.gameState.totalScore}</p>
                <p>Recorde: ${this.gameState.highScore}</p>
                <button class="btn-play" onclick="gameManager.restartGame()">
                    Jogar Novamente
                </button>
                <button class="btn-info" onclick="gameManager.goToLanding()">
                    Menu Principal
                </button>
            </div>
        `;
        document.body.appendChild(victoryDiv);

        this.addVictoryStyles();
    }

    /**
     * Adiciona estilos para tela de game over
     */
    addGameOverStyles() {
        if (!document.getElementById('game-over-styles')) {
            const style = document.createElement('style');
            style.id = 'game-over-styles';
            style.textContent = `
                .game-over-screen, .victory-screen {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.9);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: 1000;
                }
                .game-over-content, .victory-content {
                    background: linear-gradient(135deg, hsl(210, 50%, 15%) 0%, hsl(210, 50%, 23%) 100%);
                    padding: 3rem;
                    border-radius: 1rem;
                    text-align: center;
                    box-shadow: 0 0 40px rgba(79, 195, 247, 0.4);
                    border: 2px solid hsl(199, 89%, 70%);
                }
                .game-over-content h1, .victory-content h1 {
                    font-size: 3rem;
                    margin-bottom: 1rem;
                    color: hsl(199, 89%, 70%);
                }
                .game-over-content p, .victory-content p {
                    font-size: 1.25rem;
                    margin: 0.5rem 0;
                    color: hsl(200, 100%, 97%);
                }
                .game-over-content button, .victory-content button {
                    margin: 1rem 0.5rem;
                }
            `;
            document.head.appendChild(style);
        }
    }

    /**
     * Adiciona estilos para tela de vitória
     */
    addVictoryStyles() {
        this.addGameOverStyles(); // Reutiliza os mesmos estilos
    }

    /**
     * Reinicia o jogo
     */
    restartGame() {
        // Remove telas de game over/vitória
        const gameOverScreen = document.querySelector('.game-over-screen');
        const victoryScreen = document.querySelector('.victory-screen');
        if (gameOverScreen) gameOverScreen.remove();
        if (victoryScreen) victoryScreen.remove();

        // Reinicia o jogo
        this.startGame();
    }

    /**
     * Volta para landing page
     */
    goToLanding() {
        // Remove telas de game over/vitória
        const gameOverScreen = document.querySelector('.game-over-screen');
        const victoryScreen = document.querySelector('.victory-screen');
        if (gameOverScreen) gameOverScreen.remove();
        if (victoryScreen) victoryScreen.remove();

        // Volta para landing
        this.switchTo('landing');
    }

    /**
     * Atualiza o loop do jogo
     */
    update() {
        if (this.currentScene && this.currentScene.isActive) {
            this.currentScene.draw();
        }
    }

    /**
     * Lida com redimensionamento da janela
     */
    handleResize() {
        if (this.currentScene) {
            this.currentScene.handleResize();
        }
    }

    /**
     * Lida com cliques do mouse
     */
    handleMousePressed() {
        if (this.currentScene) {
            this.currentScene.handleMousePressed();
        }
    }

    /**
     * Lida com teclas pressionadas
     */
    handleKeyPressed() {
        if (this.currentScene) {
            this.currentScene.handleKeyPressed();
        }
    }

    /**
     * Salva high score no localStorage
     */
    saveHighScore(score) {
        try {
            localStorage.setItem('neurobeep_highscore', score.toString());
        } catch (e) {
            console.warn('Could not save high score:', e);
        }
    }

    /**
     * Carrega high score do localStorage
     */
    loadHighScore() {
        try {
            const saved = localStorage.getItem('neurobeep_highscore');
            return saved ? parseInt(saved, 10) : 0;
        } catch (e) {
            console.warn('Could not load high score:', e);
            return 0;
        }
    }
}
