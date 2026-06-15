// Scene.js
// ============================================================
//  Classe base para todas as cenas do NeuroBeep.
//  Define a interface comum e comportamentos padrão.
// ============================================================

export class Scene {
    constructor(name) {
        this.name      = name;
        this.isActive  = false;
        this.elements  = [];
    }

    /** Chamado uma vez quando a cena é inicializada. */
    setup() {
        console.log(`[Scene] setup: ${this.name}`);
    }

    /** Chamado a cada frame quando a cena está ativa. */
    draw() {}

    /** Ativa a cena. */
    enter() {
        this.isActive = true;
        console.log(`[Scene] enter: ${this.name}`);
    }

    /** Desativa a cena. */
    exit() {
        this.isActive = false;
        console.log(`[Scene] exit: ${this.name}`);
    }

    /** Limpa recursos criados pela cena (elementos DOM, listeners etc.). */
    cleanup() {
        this.elements.forEach(el => { if (el?.remove) el.remove(); });
        this.elements = [];
    }

    /** Chamado quando a janela é redimensionada. */
    handleResize() {}

    /** Chamado quando o mouse é pressionado. */
    handleMousePressed() {}

    /** Chamado quando uma tecla é pressionada. */
    handleKeyPressed() {}
}