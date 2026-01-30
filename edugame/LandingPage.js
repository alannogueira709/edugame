import { Scene } from './Scene.js';

/**
 * Classe LandingPage - Tela inicial do jogo
 * Herda de Scene e implementa a interface da landing page
 */
export class LandingPage extends Scene {
    constructor() {
        super('LandingPage');
        this.overlay = null;
        this.playButton = null;
        this.infoButton = null;
    }

    /**
     * Configura a landing page
     */
    setup() {
        super.setup();
        this.createOverlay();
        this.setupButtons();
    }

    /**
     * Cria a overlay HTML da landing page
     */
    createOverlay() {
        // A overlay já existe no HTML, apenas precisamos referenciá-la
        this.overlay = document.querySelector('.content-overlay');
        if (this.overlay) {
            this.overlay.style.display = 'flex';
        }
    }

    /**
     * Configura os botões da landing page
     */
    setupButtons() {
        this.playButton = document.querySelector('.btn-play');
        this.infoButton = document.querySelector('.btn-info');

        if (this.playButton) {
            this.playButton.onclick = () => this.onPlayClicked();
        }

        if (this.infoButton) {
            this.infoButton.onclick = () => this.onInfoClicked();
        }
    }

    /**
     * Desenha o background animado da landing page
     */
    draw() {
        if (!this.isActive) return;

        // Background com transparência para efeito de overlay
        background(46, 153, 191, 25);
        
        // Você pode adicionar partículas ou outros efeitos visuais aqui
        this.drawParticles();
    }

    /**
     * Desenha partículas decorativas (exemplo)
     */
    drawParticles() {
        // Implementação de partículas pode ser adicionada aqui
        // Por exemplo, círculos flutuantes, estrelas, etc.
    }

    /**
     * Callback quando o botão Play é clicado
     */
    onPlayClicked() {
        console.log('Play button clicked!');
        // Este método será sobrescrito pelo GameManager para trocar de cena
    }

    /**
     * Callback quando o botão Info é clicado
     */
    onInfoClicked() {
        console.log('Info button clicked!');
        // Pode abrir um modal com instruções
        this.showInstructions();
    }

    /**
     * Mostra instruções do jogo
     */
    showInstructions() {
        // Implementar modal de instruções
        alert('Instruções do jogo serão exibidas aqui!');
    }

    /**
     * Ativa a landing page
     */
    enter() {
        super.enter();
        if (this.overlay) {
            this.overlay.style.display = 'flex';
        }
    }

    /**
     * Desativa a landing page
     */
    exit() {
        super.exit();
        if (this.overlay) {
            this.overlay.style.display = 'none';
        }
    }

    /**
     * Lida com redimensionamento
     */
    handleResize() {
        // Ajustes específicos da landing page se necessário
    }
}
