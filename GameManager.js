// GameManager.js

export class GameManager {

    constructor() {
        this.scenes       = new Map();
        this.currentScene = null;
        this.currentSceneName = null; // rastreia a chave da cena ativa

        this.sessionState = {
            totalScore:          0,
            currentPhase:        0,
            roteiroSelecionado:  null,
            payloadsPedagogicos: [],
            highScore:           this._loadHighScore(),
        };
    }

    addScene(key, scene) {
        this.scenes.set(key, scene);
        console.log(`[GameManager] Cena registrada: "${key}"`);
    }

    init() {
        console.log('[GameManager] Inicializado');
        this.switchTo('landing');
    }

    switchTo(sceneKey, options = {}) {
        const nextScene = this.scenes.get(sceneKey);
        if (!nextScene) {
            console.error(`[GameManager] Cena não encontrada: "${sceneKey}"`);
            return;
        }

        if (this.currentScene) {
            this.currentScene.exit();
            this.currentScene.cleanup();
        }

        this.currentScene     = nextScene;
        this.currentSceneName = sceneKey; // atualiza a chave ativa
        this.currentScene.setup();
        this.currentScene.enter();

        if (options.onPhaseComplete) this.currentScene.onPhaseComplete = options.onPhaseComplete;
        if (options.onGameOver)      this.currentScene.onGameOver      = options.onGameOver;
        if (options.onBaselineOk)    this.currentScene.onBaselineOk    = options.onBaselineOk;
        if (options.onRoteiroChosen) this.currentScene.onRoteiroChosen = options.onRoteiroChosen;

        console.log(`[GameManager] → "${sceneKey}"`);
    }

    startGame() {
        const hasFlowScenes = this.scenes.has('roteiro') && this.scenes.has('baseline');
        console.log('[GameManager] Iniciando jogo');
        this.sessionState.totalScore          = 0;
        this.sessionState.payloadsPedagogicos = [];

        if (!hasFlowScenes) {
            this.sessionState.roteiroSelecionado = null;
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

    _onRoteiroChosen(roteiro) {
        console.log(`[GameManager] Roteiro escolhido: "${roteiro.nome}"`);
        this.sessionState.roteiroSelecionado = roteiro;
        this.switchTo('baseline', {
            onBaselineOk: () => this._onBaselineOk(),
        });
    }

    _onBaselineOk() {
        const roteiro = this.sessionState.roteiroSelecionado;
        if (!roteiro) {
            console.error('[GameManager] Baseline ok mas sem roteiro definido.');
            return;
        }
        console.log('[GameManager] Baseline validado → iniciando fase');
        this._iniciarFaseComRoteiro(roteiro);
    }

    _iniciarFaseComRoteiro(roteiro) {
        const faseKey = roteiro.faseKey ?? 'phase1';
        const fase    = this.scenes.get(faseKey);
        if (!fase) {
            console.error(`[GameManager] Fase não encontrada: "${faseKey}"`);
            return;
        }
        fase.questoes = roteiro.questoes ?? [];
        this.sessionState.currentPhase = Number(faseKey.replace('phase', '')) || 1;
        this.switchTo(faseKey, {
            onPhaseComplete: (payload) => this._onPhaseComplete(payload),
            onGameOver:      ()        => this._onGameOver(),
        });
    }

    _onPhaseComplete(payload) {
        console.log('[GameManager] Fase concluída. Payload:', payload);
        this.sessionState.totalScore += payload?.metadados?.totalScore ?? 0;
        this.sessionState.payloadsPedagogicos.push(payload);
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

    restartGame() {
        this.sessionState.totalScore          = 0;
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

    goToLanding() {
        this.switchTo('landing');
    }

    getPayloadSessao() {
        return {
            highScore:  this.sessionState.highScore,
            totalScore: this.sessionState.totalScore,
            roteiro:    this.sessionState.roteiroSelecionado?.nome ?? '—',
            timestamp:  new Date().toISOString(),
            fases:      this.sessionState.payloadsPedagogicos,
        };
    }

    update() {
        if (this.currentScene?.isActive) {
            this.currentScene.draw();
        }
    }

    handleResize()       { this.currentScene?.handleResize(); }
    handleMousePressed() { this.currentScene?.handleMousePressed(); }
    handleKeyPressed()   { this.currentScene?.handleKeyPressed(); }

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
            return 0;
        }
    }
}