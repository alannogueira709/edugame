// GamePhase.js
import { Scene } from './Scene.js';
import { generateLinearWordLayout, selectRandomElement } from './utils.js';

// ============================================================
//  CONSTANTES — Códigos de Status de Resposta (doc §8, Grupo C)
// ============================================================
export const STATUS_RESPOSTA = {
    ACERTO_CONSOLIDADO:  1, // Acertou de 1ª e confirmou que sabia
    ACERTO_ASSISTIDO:    2, // Acertou na 2ª tentativa após dica
    ACERTO_CASUAL:       3, // Acertou de 1ª, mas disse que chutou
    ERRO_COGNITIVO:      4, // Errou nas duas tentativas
    OMISSAO_TIMEOUT:     5, // Tempo esgotado, aluno não interagiu
    ERRO_EXECUCAO:       6, // Moveu mas não parou / passou direto
    ERRO_ESPACIAL:       7, // Parou em zona neutra (entre alternativas)
};

const INERTIA_TRIGGER_MS  = 15_000;
const TIMEOUT_DURATION_MS = 60_000;
const VICTORY_DISPLAY_MS  =  3_000;
const BT_PACKET_STALE_MS  = 1_500;
const RESULT_PANEL_MS     =  2_200;

const DEFAULT_BT_CONFIG = {
    serviceUUID: '4fafc201-1fb5-459e-8fcc-c5c9c331914b',
    characteristicUUID: 'beb5483e-36e1-4688-b7f5-ea07361b26a8',
    deviceNamePrefix: 'ESP32',
};

const ROBOT_VIDEO_SOURCES = {
    idling: [
        'assets/sprites/robot_idlings-prite.mp4',
    ],
    talking: [
        'assets/sprites/robot-talking_sprite.mp4',
    ],
    right: [
        'assets/sprites/robot-right_answer.mp4',
    ],
    wrong: [
        'assets/sprites/robot-wrong_answer.mp4',
    ],
};

// ============================================================
//  QuestionLog — "Bilhete de Identidade" de cada questão
// ============================================================
export class QuestionLog {
    constructor(questaoId, habilidadeBNCC) {
        this.questaoId              = questaoId;
        this.habilidadeBNCC         = habilidadeBNCC;
        this.statusResposta         = null;
        this.verificacaoCompreensao = null;
        this.timestampInicio        = null;
        this.timestampFim           = null;
        this.latenciaMs             = null;
        this.tentativas             = 0;
        this.respostaEscolhida1     = null;
        this.respostaEscolhida2     = null;
    }

    iniciar() {
        this.timestampInicio = Date.now();
    }

    finalizar(statusResposta, verificacaoCompreensao = null) {
        this.timestampFim           = Date.now();
        this.latenciaMs             = this.timestampFim - (this.timestampInicio ?? this.timestampFim);
        this.statusResposta         = statusResposta;
        this.verificacaoCompreensao = verificacaoCompreensao;
    }

    toPayload() {
        return {
            questaoId:              this.questaoId,
            habilidadeBNCC:         this.habilidadeBNCC,
            statusResposta:         this.statusResposta,
            verificacaoCompreensao: this.verificacaoCompreensao,
            timestampInicio:        this.timestampInicio,
            timestampFim:           this.timestampFim,
            latenciaMs:             this.latenciaMs,
            tentativas:             this.tentativas,
            respostaEscolhida1:     this.respostaEscolhida1,
            respostaEscolhida2:     this.respostaEscolhida2,
        };
    }
}

// ============================================================
//  Máquina de Estados
// ============================================================
const PHASE_STATE = {
    IDLE:             'idle',
    APRESENTACAO:     'apresentacao',
    ESPERA_ATIVA:     'espera_ativa',
    ESPERA_INCENTIVO: 'espera_incentivo',
    DECISAO_1:        'decisao_1',
    COMPREENSAO:      'compreensao',
    FEEDBACK_ERRO:    'feedback_erro',
    ESPERA_2:         'espera_2',
    DECISAO_2:        'decisao_2',
    FEEDBACK_FINAL:   'feedback_final',
    ENCERRAMENTO:     'encerramento',
};

// ============================================================
//  GamePhase — classe base
// ============================================================
export class GamePhase extends Scene {

    constructor(name, phaseNumber) {
        super(name);
        this.phaseNumber     = phaseNumber;
        this.score           = 0;
        this.lives           = 3;
        this.isPaused        = false;
        this.gameUI          = null;
        this.sprites         = [];

        // Roteiro
        this.questoes          = [];
        this.questaoAtualIndex = -1;
        this.questaoAtual      = null;

        // Logs
        this.logAtual    = null;
        this.logsSession = [];

        // Máquina de estados
        this.state          = PHASE_STATE.IDLE;
        this.tentativaAtual = 0;

        // Watchdogs
        this._inertiaTimerId = null;
        this._timeoutTimerId = null;
        this.timerIncentivo  = 0;
        this._timerInterval  = null;

        // Zonas
        this.zonas            = [];
        this.zonasCompreensao = [];

        // Player
        this.playerSprite = null;
        this.player = { x: 50, y: 50, w: 80, h: 80, vx: 0, vy: 0, speed: 5 };
        this.movementControl = {
            isMoving: false,
            direction: 1, // 1 = frente (direita), -1 = tras (esquerda)
            speed: 6,
            pendingResolution: false,
        };

        // Palavra aleatoria (atividade pedagogica)
        this.currentWord = '';
        this.wordLayout = { letters: [], spacing: 0, lineY: 0, totalWidth: 0 };
        this.resultPanel = {
            visible: false,
            selectedLabel: '—',
            selectedDistance: 0,
            correctLabel: '—',
            correctDistance: 0,
            proximityLabel: '',
            interOptionDistances: [],
        };
        this._resultPanelTimerId = null;
        this.wordInputUI = {
            container: null,
            input: null,
            button: null,
        };
        this._globalKeydownHandler = null;

        // Entrada Bluetooth (ESP32 -> x/y do robo)
        this.bluetoothConfig = { ...DEFAULT_BT_CONFIG, ...(window?.NEUROBEEP_BT_CONFIG ?? {}) };
        this.bluetoothInput = {
            isConnecting: false,
            isConnected: false,
            device: null,
            server: null,
            characteristic: null,
            normalizedX: 0.5,
            normalizedY: 0.5,
            rawX: null,
            rawY: null,
            lastPacketAt: 0,
            source: 'keyboard',
        };

        // Feedback
        this.feedbackMessage = '';
        this.feedbackColor   = [255, 255, 255];
        this.showTimerBadge  = false;

        // Avatar em video (sequencias por situacao)
        this.robotVideos = {};
        this.currentRobotVideo = null;
        this.currentRobotVideoKey = null;
        this.robotSequenceNonce = 0;
    }

    // ── Setup ────────────────────────────────────────────────

    setup() {
        super.setup();
        this._criarGameUI();
        this._criarPainelPalavra();
        this._instalarControlesGlobais();
        this._setupRobotVideos();
        this.initializePhase();
    }

    _criarGameUI() {
        const overlay = document.querySelector('.content-overlay');
        if (overlay) overlay.style.display = 'none';

        this.gameUI = document.createElement('div');
        this.gameUI.className = 'game-ui';
        this.gameUI.innerHTML = `
            <div class="game-header">
                <div class="score">Pontuação: <span id="score-value">0</span></div>
                <div class="phase">Fase: <span id="phase-value">${this.phaseNumber}</span></div>
                <div class="lives">Vidas: <span id="lives-value">${this.lives}</span></div>
            </div>`;
        document.body.appendChild(this.gameUI);
        this.elements.push(this.gameUI);
    }

    _criarPainelPalavra() {
        const container = document.createElement('div');
        container.className = 'word-input-panel';
        container.style.position = 'fixed';
        container.style.top = '84px';
        container.style.left = '24px';
        container.style.zIndex = '250';
        container.style.display = 'flex';
        container.style.gap = '8px';
        container.style.alignItems = 'center';
        container.style.padding = '10px 12px';
        container.style.background = 'rgba(6, 18, 24, 0.78)';
        container.style.border = '1px solid rgba(255,255,255,0.25)';
        container.style.borderRadius = '12px';
        container.style.backdropFilter = 'blur(4px)';
        container.style.pointerEvents = 'auto';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Digite a palavra';
        input.maxLength = 24;
        input.value = this.currentWord || '';
        input.style.minWidth = '220px';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'game-button';
        button.textContent = 'Aplicar Palavra';

        button.addEventListener('click', () => this._aplicarPalavraDoInput());
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this._aplicarPalavraDoInput();
            }
        });

        container.appendChild(input);
        container.appendChild(button);
        document.body.appendChild(container);

        this.wordInputUI = { container, input, button };
        this.elements.push(container);
    }

    _instalarControlesGlobais() {
        this._globalKeydownHandler = (event) => {
            const targetTag = event?.target?.tagName?.toLowerCase?.() ?? '';
            const isTyping = targetTag === 'input' || targetTag === 'textarea';
            if (isTyping) return;

            if (event.code === 'Space') {
                event.preventDefault();
                this._alternarMovimentoComEspaco();
                return;
            }
            if (event.code === 'ArrowLeft') {
                event.preventDefault();
                this.movementControl.direction = -1;
                return;
            }
            if (event.code === 'ArrowRight') {
                event.preventDefault();
                this.movementControl.direction = 1;
            }
        };

        document.addEventListener('keydown', this._globalKeydownHandler, { passive: false });
    }

    _aplicarPalavraDoInput() {
        const value = String(this.wordInputUI.input?.value ?? '').trim().toUpperCase();
        if (!value) return;
        this.currentWord = value;
        this._atualizarLayoutPalavra();
        this.feedbackMessage = `Palavra aplicada: ${value}`;
        this.feedbackColor = [120, 220, 255];
    }

    // @override — subclasses definem questoes[] e chamam iniciarRoteiro()
    initializePhase() {
        console.log(`[GamePhase] Inicializando fase ${this.phaseNumber}`);
    }

    // ── Roteiro ───────────────────────────────────────────────

    iniciarRoteiro() {
        if (!this.questoes.length) { console.warn('[GamePhase] Roteiro vazio.'); return; }
        this.questaoAtualIndex = -1;
        this._avancarQuestao();
    }

    _avancarQuestao() {
        this.questaoAtualIndex += 1;
        if (this.questaoAtualIndex >= this.questoes.length) { this._encerrarFase(); return; }

        this.questaoAtual     = this.questoes[this.questaoAtualIndex];
        this.tentativaAtual   = 0;
        this.zonas            = [];
        this.zonasCompreensao = [];
        this.feedbackMessage  = '';
        this.resultPanel.visible = false;
        this.movementControl.isMoving = false;
        this.movementControl.pendingResolution = false;
        if (this._resultPanelTimerId) {
            clearTimeout(this._resultPanelTimerId);
            this._resultPanelTimerId = null;
        }
        this._selecionarPalavraAtual();
        this._atualizarLayoutPalavra();
        if (this.wordInputUI.input) this.wordInputUI.input.value = this.currentWord;

        this.logAtual = new QuestionLog(this.questaoAtual.id, this.questaoAtual.bncc);
        this.logAtual.iniciar();

        this._mudarEstado(PHASE_STATE.APRESENTACAO);
        this._emitirEstimulo();
    }

    // ── Máquina de estados ────────────────────────────────────

    _mudarEstado(novoEstado) {
        console.log(`[Estado] ${this.state} → ${novoEstado}`);
        this.state = novoEstado;
    }

    // 7.1 — Estímulo
    _emitirEstimulo() {
        this._resetarWatchdogs();
        this._gerarZonas();
        this._mudarEstado(PHASE_STATE.ESPERA_ATIVA);
        this.reproduzirAudioQuestao(this.questaoAtual);
        this._inertiaTimerId = setTimeout(() => this._ativarModoIncentivoGamificado(), INERTIA_TRIGGER_MS);
    }

    // 7.2 — Watchdog de inércia
    _ativarModoIncentivoGamificado() {
        if (this.state !== PHASE_STATE.ESPERA_ATIVA && this.state !== PHASE_STATE.ESPERA_2) return;
        this._mudarEstado(PHASE_STATE.ESPERA_INCENTIVO);
        this.showTimerBadge = true;
        this.timerIncentivo = TIMEOUT_DURATION_MS / 1000;
        this.reproduzirMidia('incentivo', 'Vamos lá, você consegue!');

        this._timerInterval  = setInterval(() => {
            this.timerIncentivo -= 1;
            if (this.timerIncentivo <= 0) this._onTimeout();
        }, 1_000);
        this._timeoutTimerId = setTimeout(() => this._onTimeout(), TIMEOUT_DURATION_MS);
    }

    // 7.2 — Timeout real
    _onTimeout() {
        if (this.state !== PHASE_STATE.ESPERA_INCENTIVO) return;
        this._limparTimers();
        this.logAtual.tentativas = this.tentativaAtual + 1;
        if (this.tentativaAtual < 1) {
            this._processarResultado(STATUS_RESPOSTA.OMISSAO_TIMEOUT, null);
        } else {
            this._processarResultadoFinal(STATUS_RESPOSTA.OMISSAO_TIMEOUT);
        }
    }

    // 7.3 — 1ª tentativa
    registrarInteracao(zonaId) {
        if (this.state !== PHASE_STATE.ESPERA_ATIVA && this.state !== PHASE_STATE.ESPERA_INCENTIVO) return;
        this._limparTimers();
        this.showTimerBadge = false;
        this.tentativaAtual += 1;
        this._mudarEstado(PHASE_STATE.DECISAO_1);

        const zona = this._encontrarZona(zonaId);
        this.logAtual.respostaEscolhida1 = zonaId;

        if (!zona) {
            this._processarResultado(STATUS_RESPOSTA.ERRO_ESPACIAL, null);
        } else if (zona.isCorrect) {
            this._iniciarVerificacaoCompreensao();
        } else {
            this._processarResultado(STATUS_RESPOSTA.ERRO_COGNITIVO, zona);
        }
    }

    // 7.3A — Verificação de compreensão
    _iniciarVerificacaoCompreensao() {
        this._mudarEstado(PHASE_STATE.COMPREENSAO);
        this._gerarZonasCompreensao();
        this.reproduzirMidia('compreensao', 'Muito bem! Você SABIA a resposta ou foi um CHUTE?');
    }

    registrarCompreensao(escolha) {
        if (this.state !== PHASE_STATE.COMPREENSAO) return;
        const sabia  = (escolha === 'sabia');
        const status = sabia ? STATUS_RESPOSTA.ACERTO_CONSOLIDADO : STATUS_RESPOSTA.ACERTO_CASUAL;
        this.logAtual.finalizar(status, sabia);
        this.logsSession.push(this.logAtual);
        this.reproduzirMidia(
            sabia ? 'reforcao_positivo' : 'explicacao_conteudo',
            sabia ? 'Parabéns!' : 'Deixa eu te explicar por que está certo...'
        );
        this.addScore(sabia ? 150 : 100);
        this._iniciarEncerramento();
    }

    // 7.3B — Feedback de erro + libera 2ª tentativa
    _processarResultado(statusTemp, zona) {
        this._mudarEstado(PHASE_STATE.FEEDBACK_ERRO);
        this.movementControl.isMoving = false;
        const tiposMidia = {
            [STATUS_RESPOSTA.OMISSAO_TIMEOUT]: ['engajamento',        'O robô está esperando, vamos tentar?'],
            [STATUS_RESPOSTA.ERRO_EXECUCAO]:   ['alerta_execucao',    'Cuidado, precisa parar o robô na hora certa!'],
            [STATUS_RESPOSTA.ERRO_ESPACIAL]:   ['orientacao_espacial','Você parou no meio do caminho! Leve o robô até a resposta.'],
            [STATUS_RESPOSTA.ERRO_COGNITIVO]:  ['scaffolding',        'Não é essa. Preste atenção na dica...'],
        };
        const [tipo, texto] = tiposMidia[statusTemp] ?? ['scaffolding', 'Tente novamente!'];
        this.reproduzirMidia(tipo, texto);
        this._resetarPosicaoRobo();
        setTimeout(() => this._liberarSegundaTentativa(), 4_000);
    }

    // 7.4 — 2ª tentativa
    _liberarSegundaTentativa() {
        this._mudarEstado(PHASE_STATE.ESPERA_2);
        this._inertiaTimerId = setTimeout(() => this._ativarModoIncentivoGamificado(), INERTIA_TRIGGER_MS);
    }

    registrarInteracao2(zonaId) {
        if (this.state !== PHASE_STATE.ESPERA_2 && this.state !== PHASE_STATE.ESPERA_INCENTIVO) return;
        this._limparTimers();
        this.showTimerBadge = false;
        this.tentativaAtual += 1;
        this._mudarEstado(PHASE_STATE.DECISAO_2);

        const zona = this._encontrarZona(zonaId);
        this.logAtual.respostaEscolhida2 = zonaId;
        this.logAtual.tentativas = 2;

        if (zona?.isCorrect) {
            this.logAtual.finalizar(STATUS_RESPOSTA.ACERTO_ASSISTIDO, null);
            this.logsSession.push(this.logAtual);
            this.reproduzirMidia('reforcao_persistencia', 'Muito bem! Com a dica você conseguiu!');
            this.addScore(50);
            this._iniciarEncerramento();
        } else {
            this._processarResultadoFinal(zona ? STATUS_RESPOSTA.ERRO_COGNITIVO : STATUS_RESPOSTA.ERRO_ESPACIAL);
        }
    }

    // 7.4D — Resolução final (robô demonstra)
    _processarResultadoFinal(statusFinal) {
        this._mudarEstado(PHASE_STATE.FEEDBACK_FINAL);
        this.movementControl.isMoving = false;
        this.logAtual.finalizar(statusFinal, false);
        this.logsSession.push(this.logAtual);
        if (statusFinal === STATUS_RESPOSTA.ERRO_COGNITIVO) {
            this.reproduzirMidia('erro_cognitivo_reincidente', 'Vamos tentar de outro jeito.');
        } else {
            this.reproduzirMidia('resolucao', 'Deixa eu te explicar qual era a resposta certa...');
        }
        this._demonstrarRespostaCorreta();
        setTimeout(() => this._iniciarEncerramento(), 5_000);
    }

    // 7.5 — Encerramento do ciclo
    _iniciarEncerramento() {
        this._mudarEstado(PHASE_STATE.ENCERRAMENTO);
        this.movementControl.isMoving = false;
        this.resultPanel.visible = false;
        this._salvarLogParcial();
        setTimeout(() => this._avancarQuestao(), VICTORY_DISPLAY_MS);
    }

    _encerrarFase() {
        const payload = this._gerarPayloadFinal();
        this.onPhaseComplete(payload);
    }

    // ── Loop de desenho ──────────────────────────────────────

    draw() {
        if (!this.isActive || this.isPaused) return;
        background(46, 153, 191);
        this._drawCenario();
        this._drawPalavraAtual();
        this._drawZonas();
        this._drawPlayer();
        this._drawRobotVideo();
        this._drawResultPanel();
        this._drawHUD();
        this._atualizarMovimento();
        this._verificarColisoes();
        this._atualizarUI();
        this.checkGameState();
    }

    _drawCenario() { /* @override */ }

    _drawZonas() {
        const lista = (this.state === PHASE_STATE.COMPREENSAO) ? this.zonasCompreensao : this.zonas;
        for (const z of lista) this._drawZona(z);
    }

    _drawPalavraAtual() {
        if (!this.currentWord || !this.wordLayout.letters.length) return;

        push();
        for (const letter of this.wordLayout.letters) {
            fill(0, 0, 0, 110);
            noStroke();
            rect(letter.x - 6, letter.y - 8, letter.size + 12, letter.size + 16, 12);

            fill(255);
            textAlign(CENTER, CENTER);
            textStyle(BOLD);
            textSize(letter.size * 0.72);
            text(letter.char, letter.x + letter.size / 2, letter.y + letter.size / 2 + 2);
        }
        pop();
    }

    _drawZona(zona) {
        push();
        rectMode(CORNER);
        const corBorda = (zona.isCorrect && this.state === PHASE_STATE.FEEDBACK_FINAL)
            ? [80, 220, 100] : [255, 255, 255];
        stroke(...corBorda);
        strokeWeight(3);
        fill(255, 255, 255, 40);
        rect(zona.x, zona.y, zona.w, zona.h, 12);
        noStroke();
        fill(255);
        textAlign(CENTER, CENTER);
        textSize(22);
        textStyle(BOLD);
        text(zona.label, zona.x + zona.w / 2, zona.y + zona.h / 2);
        pop();
    }

    _drawPlayer() {
        if (this.playerSprite) {
            image(this.playerSprite, this.player.x, this.player.y, this.player.w, this.player.h);
        } else {
            push();
            fill(79, 195, 247); stroke(255); strokeWeight(2);
            rect(this.player.x, this.player.y, this.player.w, this.player.h, 8);
            noStroke(); fill(255); textAlign(CENTER, CENTER); textSize(11);
            text('ROBÔ', this.player.x + this.player.w / 2, this.player.y + this.player.h / 2);
            pop();
        }
    }

    _drawRobotVideo() {
        if (!this.currentRobotVideo?.elt) return;
        const el = this.currentRobotVideo.elt;
        if (el.readyState < 2) return;

        const w = Math.min(360, width * 0.26);
        const h = w * 0.72;
        const x = width - w - 24;
        const y = height - h - 150;

        push();
        fill(0, 0, 0, 100);
        noStroke();
        rect(x - 8, y - 8, w + 16, h + 16, 12);
        image(this.currentRobotVideo, x, y, w, h);
        pop();
    }

    _drawHUD() {
        push();
        rectMode(CORNER);

        // Enunciado
        if (this.questaoAtual && this.state !== PHASE_STATE.IDLE) {
            fill(0, 0, 0, 160); noStroke();
            rect(20, 60, width - 40, 70, 12);
            fill(255, 215, 0); textAlign(CENTER, CENTER); textSize(26); textStyle(BOLD);
            text(this.questaoAtual.enunciado ?? '', width / 2, 95);
        }

        if (this.currentWord) {
            fill(0, 0, 0, 130); noStroke();
            rect(20, 136, width - 40, 44, 10);
            fill(255);
            textAlign(CENTER, CENTER);
            textSize(18);
            textStyle(BOLD);
            text(`Palavra sorteada: ${this.currentWord}`, width / 2, 158);
        }

        // Timer de incentivo
        if (this.showTimerBadge && this.timerIncentivo > 0) {
            fill(200, 30, 30, 210); noStroke();
            ellipse(width / 2, height / 2, 140, 140);
            fill(255); textAlign(CENTER, CENTER); textStyle(BOLD);
            textSize(48); text(this.timerIncentivo, width / 2, height / 2 - 10);
            textSize(14); textStyle(NORMAL); text('segundos', width / 2, height / 2 + 30);
        }

        // Feedback textual
        if (this.feedbackMessage) {
            fill(0, 0, 0, 170); noStroke();
            rect(40, height - 120, width - 80, 70, 12);
            fill(...this.feedbackColor); textAlign(CENTER, CENTER); textSize(18); textStyle(NORMAL);
            text(this.feedbackMessage, width / 2, height - 85);
        }

        // Debug (remover em produção)
        fill(255, 255, 255, 80); textAlign(LEFT, TOP); textSize(11); textStyle(NORMAL);
        text(
            `Estado: ${this.state} | Q: ${this.questaoAtualIndex + 1}/${this.questoes.length} | Movimento: ${this.movementControl.isMoving ? 'EM MOVIMENTO' : 'PARADO'} | Direcao: ${this.movementControl.direction > 0 ? 'FRENTE' : 'TRAS'}`,
            10,
            height - 20
        );

        const podeMover = [PHASE_STATE.ESPERA_ATIVA, PHASE_STATE.ESPERA_INCENTIVO, PHASE_STATE.ESPERA_2, PHASE_STATE.COMPREENSAO].includes(this.state);
        if (podeMover) {
            fill(0, 0, 0, 160); noStroke();
            rect(20, height - 170, Math.min(560, width - 40), 42, 10);
            fill(255); textAlign(LEFT, CENTER); textSize(14); textStyle(NORMAL);
            text('Controles: ESPAÇO = mover/parar | SETA DIREITA = frente | SETA ESQUERDA = trás', 32, height - 149);
        }

        pop();
    }

    _drawResultPanel() {
        if (!this.resultPanel.visible) return;

        const panelW = Math.min(680, width - 60);
        const panelH = Math.min(260, height - 120);
        const x = (width - panelW) / 2;
        const y = Math.max(80, (height - panelH) / 2);

        push();
        rectMode(CORNER);
        fill(0, 0, 0, 205);
        stroke(255, 255, 255, 180);
        strokeWeight(2);
        rect(x, y, panelW, panelH, 14);

        noStroke();
        fill(255, 215, 0);
        textAlign(LEFT, TOP);
        textSize(24);
        textStyle(BOLD);
        text('Resultado da parada', x + 18, y + 14);

        fill(255);
        textSize(16);
        textStyle(NORMAL);
        text(`Mais perto: ${this.resultPanel.selectedLabel} (${Math.round(this.resultPanel.selectedDistance)} px)`, x + 18, y + 56);
        text(`Resposta correta: ${this.resultPanel.correctLabel} (${Math.round(this.resultPanel.correctDistance)} px)`, x + 18, y + 84);
        text(`Proximidade da correta: ${this.resultPanel.proximityLabel}`, x + 18, y + 112);

        fill(180, 230, 255);
        textStyle(BOLD);
        text('Distância entre letras/opções:', x + 18, y + 144);
        fill(255);
        textStyle(NORMAL);
        const lines = this.resultPanel.interOptionDistances.length
            ? this.resultPanel.interOptionDistances
            : ['Sem dados de distância entre opções.'];
        for (let i = 0; i < Math.min(4, lines.length); i += 1) {
            text(lines[i], x + 24, y + 170 + i * 22);
        }

        pop();
    }

    // ── Movimento e colisão ──────────────────────────────────

    _atualizarMovimento() {
        const ok = [PHASE_STATE.ESPERA_ATIVA, PHASE_STATE.ESPERA_INCENTIVO, PHASE_STATE.ESPERA_2, PHASE_STATE.COMPREENSAO];
        if (!ok.includes(this.state)) return;

        if (!this.movementControl.isMoving || this.movementControl.pendingResolution) return;

        this.player.vx = this.movementControl.direction * this.movementControl.speed;
        this.player.vy = 0;
        this.player.x = constrain(this.player.x + this.player.vx, 0, width - this.player.w);
        this.player.y = constrain(this.player.y, 0, height - this.player.h);
    }

    _verificarColisoes() {
        // As decisões são registradas ao pressionar ESPAÇO (parada), e não por colisão.
    }

    _colidem(a, b) {
        return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    }

    // ── Geração de zonas ─────────────────────────────────────

    _gerarZonas() {
        if (!this.questaoAtual?.alternativas) return;
        const alts = this.questaoAtual.alternativas;
        const zW = 170, zH = 86, margin = Math.max(120, width * 0.09);
        const totalW = alts.length * zW + (alts.length - 1) * margin;
        const startX = (width - totalW) / 2;
        const zY = height * 0.68;
        this.zonas = alts.map((alt, i) => ({
            id: alt.id, label: alt.label,
            x: startX + i * (zW + margin), y: zY, w: zW, h: zH,
            isCorrect: alt.id === this.questaoAtual.correta,
        }));
    }

    _selecionarPalavraAtual() {
        const banco = this.questaoAtual?.bancoPalavras ?? this.questaoAtual?.palavras ?? [];
        const palavraFixa = this.questaoAtual?.palavra;

        if (Array.isArray(banco) && banco.length > 0) {
            const selecionada = selectRandomElement(banco);
            this.currentWord = String(selecionada ?? '').trim().toUpperCase();
            return;
        }

        if (typeof palavraFixa === 'string' && palavraFixa.trim().length > 0) {
            this.currentWord = palavraFixa.trim().toUpperCase();
            return;
        }

        this.currentWord = '';
    }

    _atualizarLayoutPalavra() {
        this.wordLayout = generateLinearWordLayout(this.currentWord, width, height);
    }

    _gerarZonasCompreensao() {
        const zW = 180, zH = 80, gap = 60;
        const cX = width / 2, cY = height / 2 + 60;
        this.zonasCompreensao = [
            { id: 'sabia',  label: '💡 Eu sabia!', x: cX - zW - gap / 2, y: cY, w: zW, h: zH },
            { id: 'chutei', label: '🎲 Eu chutei!', x: cX + gap / 2,     y: cY, w: zW, h: zH },
        ];
    }

    // ── Helpers ──────────────────────────────────────────────

    _encontrarZona(id)     { return this.zonas.find(z => z.id === id) ?? null; }
    _resetarPosicaoRobo()  {
        this.player.x = 50;
        this.player.y = height * 0.52;
        this.player.vx = 0;
        this.player.vy = 0;
        this.movementControl.isMoving = false;
        this.movementControl.pendingResolution = false;
    }

    _demonstrarRespostaCorreta() {
        const z = this.zonas.find(z => z.isCorrect);
        if (!z) return;
        const tx = z.x + z.w / 2 - this.player.w / 2;
        const ty = z.y + z.h / 2 - this.player.h / 2;
        const steps = 60;
        const dx = (tx - this.player.x) / steps;
        const dy = (ty - this.player.y) / steps;
        let step = 0;
        const demo = setInterval(() => {
            this.player.x += dx; this.player.y += dy;
            if (++step >= steps) clearInterval(demo);
        }, 1000 / 60);
    }

    _resetarWatchdogs() { this._limparTimers(); this.showTimerBadge = false; this.timerIncentivo = 0; }
    _limparTimers() {
        if (this._inertiaTimerId) { clearTimeout(this._inertiaTimerId);  this._inertiaTimerId = null; }
        if (this._timeoutTimerId) { clearTimeout(this._timeoutTimerId);  this._timeoutTimerId = null; }
        if (this._timerInterval)  { clearInterval(this._timerInterval);  this._timerInterval  = null; }
    }

    _salvarLogParcial() {
        try {
            sessionStorage.setItem(
                `neurobeep_logs_fase${this.phaseNumber}`,
                JSON.stringify(this.logsSession.map(l => l.toPayload()))
            );
        } catch (_) {}
    }

    // ── Payload final (§Bloco 4) ─────────────────────────────

    _gerarPayloadFinal() {
        return {
            metadados: {
                phaseNumber:         this.phaseNumber,
                totalScore:          this.score,
                timestamp:           new Date().toISOString(),
                totalQuestoes:       this.questoes.length,
                questoesRespondidas: this.logsSession.length,
            },
            logPedagogico: this.logsSession.map(l => l.toPayload()),
        };
    }

    // ── Mídia (@override) ────────────────────────────────────

    reproduzirAudioQuestao(questao) {
        console.log(`[Mídia] Enunciado: "${questao?.enunciado}"`);
    }

    reproduzirMidia(tipo, textoFallback) {
        console.log(`[Mídia] tipo="${tipo}" | texto="${textoFallback}"`);
        this.feedbackMessage = textoFallback;
        this.feedbackColor   = this._corFeedbackPorTipo(tipo);
        this._playRobotSequenceByTipo(tipo);
    }

    _setupRobotVideos() {
        const makeVideo = (sources) => {
            const video = createVideo(sources);
            video.hide();
            video.volume(0);
            video.elt.muted = true;
            video.elt.loop = false;
            video.elt.playsInline = true;
            video.elt.setAttribute('playsinline', 'true');
            video.elt.preload = 'auto';
            this.elements.push(video);
            return video;
        };

        this.robotVideos = {
            idling: makeVideo(ROBOT_VIDEO_SOURCES.idling),
            talking: makeVideo(ROBOT_VIDEO_SOURCES.talking),
            right: makeVideo(ROBOT_VIDEO_SOURCES.right),
            wrong: makeVideo(ROBOT_VIDEO_SOURCES.wrong),
        };

        this.currentRobotVideoKey = 'idling';
        this.currentRobotVideo = this.robotVideos.idling;
        this._playRobotVideo('idling');
    }

    _playRobotVideo(key, onEnded) {
        const video = this.robotVideos[key];
        if (!video?.elt) return;

        for (const other of Object.values(this.robotVideos)) {
            if (other?.elt) {
                other.elt.onended = null;
                other.elt.pause();
            }
        }

        this.currentRobotVideoKey = key;
        this.currentRobotVideo = video;
        video.elt.currentTime = 0;
        video.play();
        video.elt.onended = () => {
            video.elt.onended = null;
            if (typeof onEnded === 'function') onEnded();
        };
    }

    _playRobotSequence(sequence) {
        if (!Array.isArray(sequence) || !sequence.length) return;
        this.robotSequenceNonce += 1;
        const nonce = this.robotSequenceNonce;
        let index = 0;

        const next = () => {
            if (nonce !== this.robotSequenceNonce) return;
            const key = sequence[index];
            if (!key) return;
            index += 1;
            this._playRobotVideo(key, () => {
                if (index < sequence.length) next();
            });
        };

        next();
    }

    _playRobotSequenceByTipo(tipo) {
        const sequenceByTipo = {
            // Acerto consolidado
            reforcao_positivo: ['idling', 'talking', 'right'],
            // Acerto casual
            explicacao_conteudo: ['idling', 'talking', 'right', 'talking'],
            // Sem movimento / dica
            incentivo: ['idling', 'talking'],
            engajamento: ['idling', 'talking'],
            // Nao parou / bateu / zona neutra
            alerta_execucao: ['idling', 'talking'],
            orientacao_espacial: ['idling', 'talking'],
            // Erro em resposta
            scaffolding: ['idling', 'talking', 'wrong', 'talking'],
            // Segunda tentativa: acerto assistido
            reforcao_persistencia: ['idling', 'talking', 'right'],
            // Erro cognitivo novamente
            erro_cognitivo_reincidente: ['talking', 'wrong'],
            // Fallback de resolucao final
            resolucao: ['idling', 'talking', 'wrong'],
            // Pergunta de compreensao
            compreensao: ['idling', 'talking'],
        };
        const seq = sequenceByTipo[tipo] ?? ['idling', 'talking'];
        this._playRobotSequence(seq);
    }

    _corFeedbackPorTipo(tipo) {
        return ({
            reforcao_positivo:     [80,  220, 100],
            reforcao_persistencia: [80,  220, 100],
            explicacao_conteudo:   [255, 215,   0],
            compreensao:           [255, 215,   0],
            incentivo:             [255, 180,  50],
            scaffolding:           [255, 180,  50],
            engajamento:           [255, 180,  50],
            alerta_execucao:       [255,  80,  80],
            orientacao_espacial:   [255, 150,  50],
            resolucao:             [200, 200, 255],
            erro_cognitivo_reincidente: [255, 120, 120],
        })[tipo] ?? [255, 255, 255];
    }

    // ── UI ───────────────────────────────────────────────────

    _atualizarUI() {
        const el = id => document.getElementById(id);
        if (el('score-value')) el('score-value').textContent = this.score;
        if (el('lives-value')) el('lives-value').textContent = this.lives;
    }

    checkGameState() { if (this.lives <= 0) this.onGameOver(); }
    addScore(pts)    { this.score += pts; }
    loseLife()       { this.lives = Math.max(0, this.lives - 1); }
    pause()          { this.isPaused = true;  this._limparTimers(); }
    resume()         { this.isPaused = false; }

    // ── Callbacks ────────────────────────────────────────────

    onPhaseComplete(payload) { console.log('[GamePhase] Fase completa!', payload); }
    onGameOver()             { console.log('[GamePhase] Game Over!'); this.pause(); }

    handleKeyPressed() {
        if (keyCode === 27) this.isPaused ? this.resume() : this.pause();
        if (key === 'b' || key === 'B') this.connectBluetoothInput();
        if (key === 'x' || key === 'X') this.disconnectBluetoothInput();
    }

    handleResize() {
        this._atualizarLayoutPalavra();
        this._gerarZonas();
        this._gerarZonasCompreensao();
        this.player.y = constrain(this.player.y, 0, height - this.player.h);
    }

    _alternarMovimentoComEspaco() {
        const estadosAtivos = [PHASE_STATE.ESPERA_ATIVA, PHASE_STATE.ESPERA_INCENTIVO, PHASE_STATE.ESPERA_2, PHASE_STATE.COMPREENSAO];
        if (!estadosAtivos.includes(this.state)) return;
        if (this.movementControl.pendingResolution) return;

        this.movementControl.isMoving = !this.movementControl.isMoving;
        this.feedbackMessage = this.movementControl.isMoving
            ? `Robô em movimento (${this.movementControl.direction > 0 ? 'frente' : 'trás'})`
            : 'Robô parado';
        this.feedbackColor = this.movementControl.isMoving ? [170, 225, 255] : [255, 230, 180];
        if (!this.movementControl.isMoving) {
            this._resolverParadaPorProximidade();
        } else {
            this.resultPanel.visible = false;
        }
    }

    _resolverParadaPorProximidade() {
        const isCompreensao = this.state === PHASE_STATE.COMPREENSAO;
        const zonasAtivas = isCompreensao ? this.zonasCompreensao : this.zonas;
        if (!Array.isArray(zonasAtivas) || !zonasAtivas.length) return;

        const playerCenter = {
            x: this.player.x + this.player.w / 2,
            y: this.player.y + this.player.h / 2,
        };
        const metrics = zonasAtivas.map((z) => {
            const zx = z.x + z.w / 2;
            const zy = z.y + z.h / 2;
            const dx = playerCenter.x - zx;
            const dy = playerCenter.y - zy;
            return {
                zona: z,
                distance: Math.sqrt((dx * dx) + (dy * dy)),
            };
        }).sort((a, b) => a.distance - b.distance);

        const maisProxima = metrics[0];
        const correta = zonasAtivas.find(z => z.isCorrect) ?? maisProxima?.zona ?? null;
        const distCorreta = correta
            ? Math.sqrt(
                ((playerCenter.x - (correta.x + correta.w / 2)) ** 2) +
                ((playerCenter.y - (correta.y + correta.h / 2)) ** 2)
            )
            : maisProxima.distance;

        const limiteAceitacao = (maisProxima?.zona?.w ?? 160) * 0.95;
        const zonaSelecionada = isCompreensao
            ? maisProxima?.zona ?? null
            : (maisProxima.distance <= limiteAceitacao ? maisProxima.zona : null);

        this.resultPanel.visible = true;
        this.resultPanel.selectedLabel = zonaSelecionada?.label ?? 'Zona neutra';
        this.resultPanel.selectedDistance = maisProxima.distance;
        this.resultPanel.correctLabel = correta?.label ?? '—';
        this.resultPanel.correctDistance = distCorreta;
        this.resultPanel.proximityLabel = this._classificarProximidade(distCorreta);
        this.resultPanel.interOptionDistances = this._calcularDistanciasEntreOpcoes(zonasAtivas);

        this.movementControl.pendingResolution = true;
        if (this._resultPanelTimerId) clearTimeout(this._resultPanelTimerId);
        this._resultPanelTimerId = setTimeout(() => {
            this.movementControl.pendingResolution = false;
            this.resultPanel.visible = false;
            this._resultPanelTimerId = null;

            if (this.state === PHASE_STATE.COMPREENSAO) {
                this.registrarCompreensao((zonaSelecionada ?? maisProxima.zona).id);
                return;
            }
            if (this.state === PHASE_STATE.ESPERA_ATIVA || this.state === PHASE_STATE.ESPERA_INCENTIVO) {
                this.registrarInteracao(zonaSelecionada?.id ?? null);
                return;
            }
            if (this.state === PHASE_STATE.ESPERA_2) {
                this.registrarInteracao2(zonaSelecionada?.id ?? null);
            }
        }, RESULT_PANEL_MS);
    }

    _classificarProximidade(distancePx) {
        if (distancePx <= 45) return 'Excelente (muito próximo)';
        if (distancePx <= 95) return 'Bom (próximo)';
        if (distancePx <= 170) return 'Regular (distância média)';
        return 'Longe da opção correta';
    }

    _calcularDistanciasEntreOpcoes(zonas) {
        const sorted = [...zonas].sort((a, b) => a.x - b.x);
        const linhas = [];
        for (let i = 0; i < sorted.length - 1; i += 1) {
            const atual = sorted[i];
            const prox = sorted[i + 1];
            const c1 = atual.x + atual.w / 2;
            const c2 = prox.x + prox.w / 2;
            const dist = Math.abs(c2 - c1);
            linhas.push(`${atual.label} ↔ ${prox.label}: ${Math.round(dist)} px`);
        }
        return linhas;
    }

    async connectBluetoothInput() {
        if (!navigator?.bluetooth) {
            console.warn('[Bluetooth] Web Bluetooth indisponivel neste navegador.');
            return;
        }
        if (this.bluetoothInput.isConnecting || this.bluetoothInput.isConnected) return;

        this.bluetoothInput.isConnecting = true;
        try {
            const device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: this.bluetoothConfig.deviceNamePrefix }],
                optionalServices: [this.bluetoothConfig.serviceUUID],
            });
            device.addEventListener('gattserverdisconnected', () => {
                console.warn('[Bluetooth] Dispositivo desconectado.');
                this.bluetoothInput.isConnected = false;
                this.bluetoothInput.source = 'keyboard';
            });

            const server = await device.gatt.connect();
            const service = await server.getPrimaryService(this.bluetoothConfig.serviceUUID);
            const characteristic = await service.getCharacteristic(this.bluetoothConfig.characteristicUUID);

            await characteristic.startNotifications();
            characteristic.addEventListener('characteristicvaluechanged', (event) => {
                this._onBluetoothPacket(event?.target?.value);
            });

            this.bluetoothInput.device = device;
            this.bluetoothInput.server = server;
            this.bluetoothInput.characteristic = characteristic;
            this.bluetoothInput.isConnected = true;
            this.bluetoothInput.source = 'bluetooth';
            console.log(`[Bluetooth] Conectado em ${device.name ?? 'ESP32'}`);
        } catch (error) {
            console.warn('[Bluetooth] Falha ao conectar:', error);
        } finally {
            this.bluetoothInput.isConnecting = false;
        }
    }

    disconnectBluetoothInput() {
        const device = this.bluetoothInput.device;
        if (device?.gatt?.connected) {
            device.gatt.disconnect();
        }
        this.bluetoothInput.isConnected = false;
        this.bluetoothInput.source = 'keyboard';
    }

    _onBluetoothPacket(dataView) {
        if (!dataView) return;
        const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
        const rawText = new TextDecoder().decode(bytes);
        const parsed = this._parseBluetoothXY(rawText);
        if (!parsed) return;

        const normalizedX = this._normalizeAxis(parsed.x);
        const normalizedY = this._normalizeAxis(parsed.y);
        this.bluetoothInput.rawX = parsed.x;
        this.bluetoothInput.rawY = parsed.y;
        this.bluetoothInput.normalizedX = normalizedX;
        this.bluetoothInput.normalizedY = normalizedY;
        this.bluetoothInput.lastPacketAt = Date.now();
    }

    _parseBluetoothXY(rawText) {
        const payload = String(rawText ?? '').trim();
        if (!payload) return null;

        try {
            const json = JSON.parse(payload);
            if (json && Number.isFinite(Number(json.x)) && Number.isFinite(Number(json.y))) {
                return { x: Number(json.x), y: Number(json.y) };
            }
        } catch (_) {}

        const xMatch = payload.match(/x\s*[:=]\s*(-?\d+(\.\d+)?)/i);
        const yMatch = payload.match(/y\s*[:=]\s*(-?\d+(\.\d+)?)/i);
        if (xMatch && yMatch) {
            return { x: Number(xMatch[1]), y: Number(yMatch[1]) };
        }

        const values = payload
            .split(/[,\s;]+/)
            .map(v => Number(v))
            .filter(v => Number.isFinite(v));
        if (values.length >= 2) return { x: values[0], y: values[1] };

        return null;
    }

    _normalizeAxis(value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) return 0.5;
        if (numericValue <= 1 && numericValue >= 0) return numericValue;
        if (numericValue >= 0 && numericValue <= 100) return numericValue / 100;
        return constrain(numericValue / 4095, 0, 1);
    }

    // ── Cleanup ──────────────────────────────────────────────

    cleanup() {
        super.cleanup();
        this._limparTimers();
        if (this._resultPanelTimerId) {
            clearTimeout(this._resultPanelTimerId);
            this._resultPanelTimerId = null;
        }
        if (this._globalKeydownHandler) {
            document.removeEventListener('keydown', this._globalKeydownHandler);
            this._globalKeydownHandler = null;
        }
        this.disconnectBluetoothInput();
        this.robotSequenceNonce += 1;
        for (const video of Object.values(this.robotVideos)) {
            if (video?.elt) {
                video.elt.onended = null;
                video.elt.pause();
            }
        }
        this.robotVideos = {};
        this.currentRobotVideo = null;
        this.currentRobotVideoKey = null;
        if (this.gameUI?.parentNode) this.gameUI.parentNode.removeChild(this.gameUI);
        this.sprites = []; this.zonas = []; this.logsSession = [];
    }

    // ── Atalhos de constantes ────────────────────────────────

    get STATUS()  { return STATUS_RESPOSTA; }
    get ESTADOS() { return PHASE_STATE; }
}
