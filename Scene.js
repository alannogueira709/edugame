/**
 * Classe base para todas as cenas do jogo
 * Define a interface comum e comportamentos padrão
 */
export class Scene {
    constructor(name) {
        this.name = name;
        this.isActive = false;
        this.elements = [];
    }

    /**
     * Método chamado quando a cena é inicializada
     */
    setup() {
        console.log(`Scene ${this.name} setup`);
    }

    /**
     * Método chamado a cada frame quando a cena está ativa
     */
    draw() {
        // Implementação base vazia
    }

    /**
     * Ativa a cena
     */
    enter() {
        this.isActive = true;
        console.log(`Entering scene: ${this.name}`);
    }

    /**
     * Desativa a cena
     */
    exit() {
        this.isActive = false;
        console.log(`Exiting scene: ${this.name}`);
    }

    /**
     * Limpa recursos da cena
     */
    cleanup() {
        this.elements.forEach(element => {
            if (element && element.remove) {
                element.remove();
            }
        });
        this.elements = [];
    }

    /**
     * Lida com eventos de redimensionamento
     */
    handleResize() {
        // Implementação padrão vazia
    }

    /**
     * Lida com cliques do mouse
     */
    handleMousePressed() {
        // Implementação padrão vazia
    }

    /**
     * Lida com teclas pressionadas
     */
    handleKeyPressed() {
        // Implementação padrão vazia
    }
}
