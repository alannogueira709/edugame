// GameManager.js

/**
 * GameManager — Orquestrador central do NeuroBeep
 *
 * Fluxo completo (§Blocos 2, 3 e 4):
 *
 *   landing → roteiro → baseline → phase (loop de questões) → finalizacao
 *                ↑                              |
 *                └──────── goToLanding() ───────┘
 *
 * Responsabilidades:
 *   • Registrar e trocar cenas
 *   • Injetar o roteiro escolhido na fase antes de iniciá-la
 *   • Receber e armazenar o payload pedagógico ao fim de cada sessão
 *   • Expor callbacks que as cenas usam para solicitar transições
 */
export class GameManager {

    // ──────────────────────────────────────────────────────────
    //  CONSTRUTOR
    // ──────────────────────────────────────────────────────────
    constructor() {
        /** @type {Map<string, import('./Scene.js').Scene>} */
        this.scenes       = new Map();
        this.currentScene = null;

        // Estado global da sessão
        this.sessionState = {
            totalScore:      0,
            currentPhase:    0,
            roteiroSelecionado: null,   // objeto completo do roteiro escolhido
            payloadsPedagogicos: [],    // acumula um payload por fase concluída
            highScore:       this._loadHighScore(),
        };
    }

    // ──────────────────────────────────────────────────────────
    //  REGISTRO DE CENAS
    // ──────────────────────────────────────────────────────────

    /**
     * Registra qualquer cena ou fase no gerenciador.
     * @param {string} key   - Chave usada em switchTo() / goToPhase()
     * @param {object} scene - Instância de Scene ou GamePhase
     */
    addScene(key, scene) {
        this.scenes.set(key, scene);
        console.log(`[GameManager] Cena registrada: "${key}"`);
    }

    // ──────────────────────────────────────────────────────────
    //  INICIALIZAÇÃO
    // ──────────────────────────────────────────────────────────

    /**
     * Ponto de entrada — chamado pelo sketch.js após registrar todas as cenas.
     * Sempre inicia na landing page.
     */
    init() {
        console.log('[GameManager] Inicializado');
        this.switchTo('landing');
    }

    // ──────────────────────────────────────────────────────────
    //  TROCA DE CENAS
    // ──────────────────────────────────────────────────────────

    /**
     * Troca para uma cena pelo nome da chave.
     * Cuida do ciclo exit → cleanup → setup → enter.
     *
     * @param {string} sceneKey
     * @param {object} [options]
     * @param {Function} [options.onPhaseComplete] - Sobrescreve o callback da cena
     * @param {Function} [options.onGameOver]      - Sobrescreve o callback da cena
     * @param {Function} [options.onBaselineOk]    - Para a cena de baseline
     * @param {Function} [options.onRoteiroChosen] - Para a cena de seleção de roteiro
     */
    switchTo(sceneKey, options = {}) {
        const nextScene = this.scenes.get(sceneKey);
        if (!nextScene) {
            console.error(`[GameManager] Cena não encontrada: "${sceneKey}"`);
            return;
        }

        // Encerra a cena atual
        if (this.currentScene) {
            this.currentScene.exit();
            this.currentScene.cleanup();
        }

        // Ativa a nova
        this.currentScene = nextScene;
        this.currentScene.setup();
        this.currentScene.enter();

        // Injeta callbacks opcionais
        if (options.onPhaseComplete) this.currentScene.onPhaseComplete = options.onPhaseComplete;
        if (options.onGameOver)      this.currentScene.onGameOver      = options.onGameOver;
        if (options.onBaselineOk)    this.currentScene.onBaselineOk    = options.onBaselineOk;
        if (options.onRoteiroChosen) this.currentScene.onRoteiroChosen = options.onRoteiroChosen;

        console.log(`[GameManager] → "${sceneKey}"`);
    }

    // ──────────────────────────────────────────────────────────
    //  FLUXO PRINCIPAL
    // ──────────────────────────────────────────────────────────

    /**
     * PASSO 1 — Landing page chama este método ao clicar "Jogar".
     * Direciona para a seleção de roteiro (§5).
     */
    startGame() {
        const hasFlowScenes = this.scenes.has('roteiro') && this.scenes.has('baseline');
        console.log('[GameManager] Iniciando jogo');
        this.sessionState.totalScore  = 0;
        this.sessionState.payloadsPedagogicos = [];

        // Compatibilidade: se as cenas de fluxo não estiverem registradas,
        // começa direto na phase1.
        if (!hasFlowScenes) {
            this.sessionState.roteiroSelecionado = null;
            this.switchTo('phase1', {
                onPhaseComplete: (payload) => this._onPhaseComplete(payload),
                onGameOver:      ()        => this._onGameOver(),
            });
            return;
        }

        this.switchTo('roteiro', {
            // Quando o educador escolher um roteiro a cena chama onRoteiroChosen(roteiro)
            onRoteiroChosen: (roteiro) => this._onRoteiroChosen(roteiro),
        });
    }

    /**
     * PASSO 2 — Recebe o roteiro escolhido e vai para o baseline (§6).
     * @param {object} roteiro - { nome, faseKey, questoes[] }
     * @private
     */
    _onRoteiroChosen(roteiro) {
        console.log(`[GameManager] Roteiro escolhido: "${roteiro.nome}"`);
        this.sessionState.roteiroSelecionado = roteiro;

        this.switchTo('baseline', {
            // Quando os 10 s de baseline passarem, a cena chama onBaselineOk()
            onBaselineOk: () => this._onBaselineOk(),
        });
    }

    /**
     * PASSO 3 — Baseline ok: injeta questões na fase e inicia (§6 → §7).
     * @private
     */
    _onBaselineOk() {
        const roteiro = this.sessionState.roteiroSelecionado;
        if (!roteiro) {
            console.error('[GameManager] Baseline ok mas sem roteiro definido.');
            return;
        }

        console.log('[GameManager] Baseline validado → iniciando fase');
        this._iniciarFaseComRoteiro(roteiro);
    }

    /**
     * PASSO 4 — Configura a fase com o roteiro e faz a troca de cena.
     * @param {object} roteiro
     * @private
     */
    _iniciarFaseComRoteiro(roteiro) {
        const faseKey = roteiro.faseKey ?? 'phase1';
        const fase    = this.scenes.get(faseKey);

        if (!fase) {
            console.error(`[GameManager] Fase não encontrada: "${faseKey}"`);
            return;
        }

        // Injeta as questões do roteiro diretamente na fase
        fase.questoes = roteiro.questoes ?? [];
        this.sessionState.currentPhase = Number(faseKey.replace('phase', '')) || 1;

        this.switchTo(faseKey, {
            // Quando todas as questões acabarem, a fase chama onPhaseComplete(payload)
            onPhaseComplete: (payload) => this._onPhaseComplete(payload),
            onGameOver:      ()        => this._onGameOver(),
        });
    }

    // ──────────────────────────────────────────────────────────
    //  CALLBACKS DE FIM DE FASE
    // ──────────────────────────────────────────────────────────

    /**
     * Chamado pela fase ao concluir todas as questões do roteiro (§Bloco 4).
     * Armazena o payload e vai para a tela de finalização.
     *
     * @param {object} payload - { metadados, logPedagogico } gerado pelo GamePhase
     * @private
     */
    _onPhaseComplete(payload) {
        console.log('[GameManager] Fase concluída. Payload recebido:', payload);

        // Acumula pontuação e payload
        this.sessionState.totalScore += payload?.metadados?.totalScore ?? 0;
        this.sessionState.payloadsPedagogicos.push(payload);

        // Atualiza high score se necessário
        this._atualizarHighScore(this.sessionState.totalScore);

        // Vai para finalização, ou volta para landing se a cena não existir.
        if (this.scenes.has('finalizacao')) {
            this.switchTo('finalizacao', {
                // A cena de finalização lerá esses dados do sessionState
                onRestart:   () => this.restartGame(),
                onGoToMenu:  () => this.goToLanding(),
            });
            return;
        }

        this.goToLanding();
    }

    /**
     * Chamado quando o aluno perde todas as vidas.
     * @private
     */
    _onGameOver() {
        console.log('[GameManager] Game Over!');
        this._atualizarHighScore(this.sessionState.totalScore);

        if (this.scenes.has('finalizacao')) {
            this.switchTo('finalizacao', {
                onRestart:  () => this.restartGame(),
                onGoToMenu: () => this.goToLanding(),
            });
            return;
        }

        this.goToLanding();
    }

    // ──────────────────────────────────────────────────────────
    //  AÇÕES GLOBAIS
    // ──────────────────────────────────────────────────────────

    /**
     * Reinicia o jogo do início (volta para seleção de roteiro).
     * Pode ser chamado pela cena de finalização ou por qualquer tela.
     */
    restartGame() {
        this.sessionState.totalScore  = 0;
        this.sessionState.payloadsPedagogicos = [];
        this.sessionState.roteiroSelecionado  = null;

        if (!this.scenes.has('roteiro')) {
            this.switchTo('phase1', {
                onPhaseComplete: (payload) => this._onPhaseComplete(payload),
                onGameOver:      ()        => this._onGameOver(),
            });
            return;
        }

        this.switchTo('roteiro', {
            onRoteiroChosen: (roteiro) => this._onRoteiroChosen(roteiro),
        });
    }

    /**
     * Volta para a landing page a partir de qualquer estado.
     */
    goToLanding() {
        this.switchTo('landing');
    }

    // ──────────────────────────────────────────────────────────
    //  ACESSO AOS DADOS DA SESSÃO
    // ──────────────────────────────────────────────────────────

    /**
     * Retorna o payload pedagógico completo da sessão atual.
     * Útil para a cena de finalização e para envio ao servidor.
     *
     * @returns {object}
     */
    getPayloadSessao() {
        return {
            highScore:    this.sessionState.highScore,
            totalScore:   this.sessionState.totalScore,
            roteiro:      this.sessionState.roteiroSelecionado?.nome ?? '—',
            timestamp:    new Date().toISOString(),
            fases:        this.sessionState.payloadsPedagogicos,
        };
    }

    // ──────────────────────────────────────────────────────────
    //  LOOP p5.js
    // ──────────────────────────────────────────────────────────

    update() {
        if (this.currentScene?.isActive) {
            this.currentScene.draw();
        }
    }

    handleResize() {
        this.currentScene?.handleResize();
    }

    handleMousePressed() {
        this.currentScene?.handleMousePressed();
    }

    handleKeyPressed() {
        this.currentScene?.handleKeyPressed();
    }

    // ──────────────────────────────────────────────────────────
    //  HIGH SCORE (persistência)
    // ──────────────────────────────────────────────────────────

    _atualizarHighScore(score) {
        if (score > this.sessionState.highScore) {
            this.sessionState.highScore = score;
            this._saveHighScore(score);
        }
    }

    _saveHighScore(score) {
        try { localStorage.setItem('neurobeep_highscore', String(score)); }
        catch (e) { console.warn('[GameManager] Não foi possível salvar high score:', e); }
    }

    _loadHighScore() {
        try {
            const saved = localStorage.getItem('neurobeep_highscore');
            return saved ? parseInt(saved, 10) : 0;
        } catch (e) {
            console.warn('[GameManager] Não foi possível carregar high score:', e);
            return 0;
        }
    }
}
