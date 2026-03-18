import { Scene } from './Scene.js';

/**
 * LandingPage - tela inicial do jogo.
 * Mantem a logica simples da cena, mas usa a nova estrutura visual da landing.
 */
export class LandingPage extends Scene {
    constructor() {
        super('LandingPage');
        this.overlay = null;
        this.playButton = null;
        this.infoButton = null;
        this.instructionsModal = null;
        this.closeButtons = [];
        this._handleBackdropClick = null;
        this._handleEscape = null;
    }

    setup() {
        super.setup();
        this.createOverlay();
        this.setupButtons();
        this.setupModal();
    }

    createOverlay() {
        this.overlay = document.querySelector('.content-overlay');
        if (this.overlay) {
            this.overlay.style.display = 'flex';
        }
    }

    setupButtons() {
        this.playButton = document.querySelector('.btn-play');
        this.infoButton = document.querySelector('.btn-info');

        if (this.playButton) {
            this.playButton.onclick = () => {
                this.hideInstructions();
                this.onPlayClicked();
            };
        }

        if (this.infoButton) {
            this.infoButton.onclick = () => this.onInfoClicked();
        }
    }

    setupModal() {
        this.instructionsModal = document.getElementById('instructions-modal');
        this.closeButtons = Array.from(document.querySelectorAll('[data-close-modal]'));

        this.closeButtons.forEach((button) => {
            button.onclick = () => this.hideInstructions();
        });

        this._handleBackdropClick = (event) => {
            if (event.target === this.instructionsModal) {
                this.hideInstructions();
            }
        };

        this._handleEscape = (event) => {
            if (event.code === 'Escape') {
                this.hideInstructions();
            }
        };

        if (this.instructionsModal) {
            this.instructionsModal.onclick = this._handleBackdropClick;
        }
        document.addEventListener('keydown', this._handleEscape);
    }

    draw() {
        if (!this.isActive) return;

        clear();
    }

    onPlayClicked() {
        console.log('Play button clicked!');
    }

    onInfoClicked() {
        this.showInstructions();
    }

    showInstructions() {
        if (!this.instructionsModal) return;
        this.instructionsModal.classList.remove('hidden');
        this.instructionsModal.setAttribute('aria-hidden', 'false');
    }

    hideInstructions() {
        if (!this.instructionsModal) return;
        this.instructionsModal.classList.add('hidden');
        this.instructionsModal.setAttribute('aria-hidden', 'true');
    }

    enter() {
        super.enter();
        if (this.overlay) {
            this.overlay.style.display = 'flex';
        }
        this.hideInstructions();
    }

    exit() {
        super.exit();
        this.hideInstructions();
        if (this.overlay) {
            this.overlay.style.display = 'none';
        }
    }

    cleanup() {
        this.hideInstructions();
        if (this.instructionsModal) {
            this.instructionsModal.onclick = null;
        }
        if (this._handleEscape) {
            document.removeEventListener('keydown', this._handleEscape);
        }
        super.cleanup();
    }

    handleResize() {
        // sem acao adicional por enquanto
    }
}
