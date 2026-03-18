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

// ============================================================
//  CONSTANTES DE LAYOUT — zonas exclusivas (sem sobreposição)
// ============================================================
const LAYOUT = {
    HUD_H:           56,   // altura do header HTML (score/fase/vidas)
    ENUNCIADO_H:     50,   // altura da caixa de enunciado
    PALAVRA_BADGE_H: 34,   // crachá "Palavra sorteada"
    ZONAS_H:         88,   // altura da faixa exclusiva de alternativas
    RODAPE_H:        44,   // altura do rodapé (controles + debug)
    SPRITE_W_MAX:   220,   // largura máxima do sprite em px
    SPRITE_W_FRAC:  0.20,  // largura do sprite como fração da tela
    SPRITE_GAP:      16,   // margem entre zona de jogo e zona do sprite
};

// Compact layout — HTML handles enunciado/palavra/zonas
LAYOUT.HUD_H          = 76;   // HUD pills are now shorter
LAYOUT.ENUNCIADO_H    = 0;    // moved to HTML
LAYOUT.PALAVRA_BADGE_H = 0;   // moved to HTML
LAYOUT.ZONAS_H        = 0;    // moved to HTML
LAYOUT.RODAPE_H       = 52;   // slim status bar
LAYOUT.SPRITE_W_MAX   = 180;
LAYOUT.SPRITE_W_FRAC  = 0.14;
LAYOUT.SPRITE_GAP     = 16;

const ROBOT_SPRITE_SOURCES = {
    idling: 'assets/sprites/sprite_sheet_idle.png',
    talking: 'assets/sprites/sprite_sheet_talking.png', 
    right:  'assets/sprites/sprite_sheet_right.png',
    wrong:  'assets/sprites/sprite_sheet_wrong.png',
};

const ROBOT_SPRITE_CONFIG = {
    fps: 15,
    columns: 5,
    rows: 20,
    transitionMs: 180,
};

// ============================================================
//  HELPER: Ponte de comunicação com o Dashboard React via Tauri
// ============================================================

// CORREÇÃO 1, 2 e 3: Substituído BroadcastChannel por window.__TAURI__.event.emit().
//
// O BroadcastChannel só funciona entre páginas da mesma origin no mesmo processo.
// No Tauri v2, cada WebviewWindow tem seu próprio contexto JS isolado, então o canal
// não conseguia atravessar da janela do projetor para a janela principal do dashboard.
//
// A API de eventos do Tauri (emit/listen) foi projetada exatamente para comunicação
// entre WebviewWindows diferentes — ela passa pelo backend Rust e entrega o evento
// para todos os listeners registrados em qualquer janela do app.
//
// Uso: tauriEmit('neurobeep_sync', { source: 'GAME', type: '...', payload: {...} })
// No React: listen('neurobeep_sync', handler) em Game.tsx

async function tauriEmit(eventName, payload) {
    try {
        // window.__TAURI__ é injetado pelo Tauri automaticamente em todas as webviews.
        // Verificamos sua existência para evitar erros caso o game rode fora do Tauri
        // (ex: no browser durante desenvolvimento).
        if (window.__TAURI__?.event?.emit) {
            await window.__TAURI__.event.emit(eventName, payload);
        } else {
            // Fallback para desenvolvimento fora do Tauri (ex: browser direto)
            console.debug('[tauriEmit] __TAURI__ não disponível. Payload:', eventName, payload);
        }
    } catch (error) {
        console.warn('[tauriEmit] Falha ao emitir evento:', error);
    }
}

// ============================================================
//  QuestionLog — "Bilhete de Identidade" de cada questão
// ============================================================
export class QuestionLog {
    constructor(sessaoId, faseAtual, questaoId, habilidadeBNCC, gabaritoId) {
        this.sessao_id = sessaoId;
        this.fase_atual = faseAtual;

        this.contexto_pedagogico = {
            id_questao: questaoId,
            habilidade_bncc: habilidadeBNCC,
            gabarito_zona: gabaritoId,
            dica_oferecida: false,
        };

        this.cronometria_sincronizada = {
            t_exibicao_pergunta: null,
            t_primeiro_movimento: null,
            t_parada_final: null,
            t_inicio_feedback: null,
            t_fim_feedback: null,
        };

        this.dinamica_neuro_motora = {
            tempo_latencia_ms: null,
            quedas_de_foco_qty: 0,
        };

        this.precisao_odometrica = {
            posicao_inicial_passos: null,
            posicao_final_passos: null,
            alvo_esperado_passos_min: null,
            alvo_esperado_passos_max: null,
            distancia_erro_passos: 0,
            micro_hesitacoes: 0,
        };

        this.resolucao_final = {
            zona_parada: null,
            status_resposta_cod: null,
            status_resposta_desc: null,
            verificacao_compreensao: null,
            resposta_escolhida_1: null,
            resposta_escolhida_2: null,
            tentativas: 0,
        };

        this._roboEstavaAndando = false;
        this._payloadEnviado = false;
    }

    marcarExibicao() {
        this.cronometria_sincronizada.t_exibicao_pergunta = Date.now();
    }

    registrarMovimento(isMoving, posicaoAtualPassos) {
        const tAtual = Date.now();

        if (isMoving && !this.cronometria_sincronizada.t_primeiro_movimento) {
            this.cronometria_sincronizada.t_primeiro_movimento = tAtual;
            const tExibicao = this.cronometria_sincronizada.t_exibicao_pergunta ?? tAtual;
            this.dinamica_neuro_motora.tempo_latencia_ms = tAtual - tExibicao;
            this.precisao_odometrica.posicao_inicial_passos = posicaoAtualPassos;
        }

        if (!isMoving && this._roboEstavaAndando && !this.cronometria_sincronizada.t_parada_final) {
            this.precisao_odometrica.micro_hesitacoes += 1;
            this.dinamica_neuro_motora.quedas_de_foco_qty += 1;
        }

        this._roboEstavaAndando = isMoving;
    }

    registrarRespostaEscolhida(tentativa, zonaId) {
        if (tentativa === 1) this.resolucao_final.resposta_escolhida_1 = zonaId;
        if (tentativa === 2) this.resolucao_final.resposta_escolhida_2 = zonaId;
        this.resolucao_final.tentativas = Math.max(this.resolucao_final.tentativas, tentativa);
    }

    registrarTentativa(tentativa) {
        this.resolucao_final.tentativas = Math.max(this.resolucao_final.tentativas, tentativa);
    }

    registrarDicaOferecida() {
        this.contexto_pedagogico.dica_oferecida = true;
    }

    registrarAlvoEsperado(passoMin, passoMax) {
        this.precisao_odometrica.alvo_esperado_passos_min = passoMin;
        this.precisao_odometrica.alvo_esperado_passos_max = passoMax;
    }

    marcarInicioFeedback() {
        if (!this.cronometria_sincronizada.t_inicio_feedback) {
            this.cronometria_sincronizada.t_inicio_feedback = Date.now();
        }
    }

    marcarFimFeedback() {
        this.cronometria_sincronizada.t_fim_feedback = Date.now();
    }

    finalizarJogada(statusCod, zonaParadaId, posicaoFinalPassos, verificacaoCompreensao = null) {
        this.cronometria_sincronizada.t_parada_final = Date.now();
        this.resolucao_final.status_resposta_cod = statusCod;
        this.resolucao_final.status_resposta_desc = this._descreverStatus(statusCod);
        this.resolucao_final.zona_parada = zonaParadaId;
        this.resolucao_final.verificacao_compreensao = verificacaoCompreensao;
        this.precisao_odometrica.posicao_final_passos = posicaoFinalPassos;
        this.precisao_odometrica.distancia_erro_passos = this._calcularDistanciaErro(posicaoFinalPassos);
    }

    toPayload() {
        const { _roboEstavaAndando, _payloadEnviado, ...payloadValido } = this;
        return payloadValido;
    }

    _calcularDistanciaErro(posicaoFinalPassos) {
        const min = this.precisao_odometrica.alvo_esperado_passos_min;
        const max = this.precisao_odometrica.alvo_esperado_passos_max;
        if (!Number.isFinite(posicaoFinalPassos) || !Number.isFinite(min) || !Number.isFinite(max)) {
            return 0;
        }
        if (posicaoFinalPassos < min) return Math.round(min - posicaoFinalPassos);
        if (posicaoFinalPassos > max) return Math.round(posicaoFinalPassos - max);
        return 0;
    }

    _descreverStatus(statusCod) {
        const descricoes = {
            1: 'Acerto Consolidado',
            2: 'Acerto Assistido',
            3: 'Acerto Casual',
            4: 'Erro Cognitivo',
            5: 'Omissão / Timeout',
            6: 'Erro de Execução',
            7: 'Erro Espacial',
        };
        return descricoes[statusCod] ?? 'Desconhecido';
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
        this.player = { x: 50, y: 0, w: 80, h: 80, vx: 0, vy: 0, speed: 5 };
        this.movementControl = {
            isMoving: false,
            direction: 1, // 1 = frente (direita), -1 = tras (esquerda)
            speed: 6,
            pendingResolution: false,
        };

        // Palavra aleatória (atividade pedagógica)
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
        this._globalKeydownHandler = null;

        // Entrada Bluetooth (ESP32 -> x/y do robô)
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

        // Avatar em sprite sheet (sequencias por situacao)
        this.robotSprites = {};
        this.currentRobotAnimation = null;
        this.currentRobotAnimationKey = null;
        this.previousRobotAnimation = null;
        this.robotTransition = null;
        this.robotSequenceNonce = 0;

        // CORREÇÃO: Removida a instância de BroadcastChannel do constructor.
        // A comunicação agora é feita via tauriEmit() (função no topo deste arquivo),
        // que usa window.__TAURI__.event.emit() — funciona entre WebviewWindows separadas.
        // Não é necessário nenhum objeto de canal aqui.
    }

    // ── Setup ────────────────────────────────────────────────

    setup() {
        super.setup();
        this._criarGameUI();
        this._instalarControlesGlobais();
        this._setupRobotSprites();
        this.initializePhase();

        // Captura de frames para miniatura: integrada no draw() via _enviarFrameMiniatura()
    }

    // Envia um frame da miniatura para o dashboard a cada N frames do draw().
    // Integrado no draw() para garantir que só roda quando o game está de fato ativo
    // e o canvas do p5.js já foi pintado naquele ciclo.
    // Throttle: envia 1 frame a cada 4 frames do draw() ≈ 15fps (assumindo 60fps).
    _enviarFrameMiniatura() {
        if (!this._frameCounter) this._frameCounter = 0;
        this._frameCounter += 1;
        if (this._frameCounter % 4 !== 0) return; // throttle ~15fps

        try {
            // drawingContext é o canvas 2D do p5.js — acessamos o elemento nativo via canvas
            const canvas = drawingContext?.canvas ?? document.querySelector('canvas');
            if (!canvas) return;
            const frame = canvas.toDataURL('image/jpeg', 0.5);
            tauriEmit('neurobeep_frame', { frame });
        } catch (_) {
            // Silencioso: canvas pode estar temporariamente indisponível
        }
    }

    _criarGameUI() {
        const overlay = document.querySelector('.content-overlay');
        if (overlay) overlay.style.display = 'none';

        this.gameUI = document.createElement('div');
        this.gameUI.className = 'game-ui';
        this.gameUI.innerHTML = `
            <!-- ── TOP HUD ── -->
            <div class="game-top-shell">
                <div class="game-header">
                    <div class="hud-pill hud-pill-score">
                        <span class="hud-icon" aria-hidden="true">&#9733;</span>
                        <span class="hud-value" id="score-value">0 pts</span>
                    </div>
                    <div class="hud-pill hud-pill-phase">
                        <span class="hud-value" id="phase-value">Fase ${this.phaseNumber}</span>
                    </div>
                    <div class="hud-pill hud-pill-lives">
                        <div class="lives-track" id="lives-track">${this._renderLivesTrack()}</div>
                    </div>
                </div>
                <div class="timer-shell" id="timer-shell">
                    <span class="timer-label">Tempo</span>
                    <div class="timer-bar-track">
                        <div class="timer-bar-fill" id="timer-bar-fill"></div>
                    </div>
                    <span class="timer-value" id="timer-value">60s</span>
                </div>
            </div>

            <!-- ── CHALLENGE CARD (enunciado + palavra + tiles) ── -->
            <div class="game-challenge-card" id="challenge-card">
                <span class="game-kicker">DESAFIO</span>
                <p class="game-enunciado" id="enunciado-text"></p>
                <div class="game-word-tiles" id="word-tiles"></div>
            </div>

            <!-- ── ALTERNATIVAS (zonas HTML) ── -->
            <div class="game-zonas-html" id="zonas-html"></div>

            <!-- ── STATUS BAR ── -->
            <div class="game-statusbar">
                <span class="status-copy" id="status-message">ESPACO move/para &nbsp;|&nbsp; ← → direção</span>
                <span class="status-chip" id="question-progress">1/1</span>
            </div>`;

        document.body.appendChild(this.gameUI);
        this.elements.push(this.gameUI);

        // ── Result modal ────────────────────────────────────────────────────
        this._resultModal = document.createElement('div');
        this._resultModal.className = 'result-modal-backdrop hidden';
        this._resultModal.id = 'result-modal';
        this._resultModal.innerHTML = `
            <div class="result-modal-card" id="result-modal-card">
                <div class="confetti-container" id="confetti-container"></div>
                <div class="result-modal-bar" id="result-modal-bar"></div>
                <div class="result-modal-body">
                    <p class="result-modal-title">Resultado da Parada</p>
                    <div class="result-status-banner" id="result-status-banner">
                        <div class="result-status-icon" id="result-status-icon"></div>
                        <div class="result-status-title" id="result-status-title"></div>
                        <div class="result-status-sub" id="result-status-sub"></div>
                    </div>
                    <div class="result-info-block">
                        <div class="result-info-row">
                            <span class="result-info-label">Resposta correta:</span>
                            <span class="result-info-value" id="result-correct-label"></span>
                        </div>
                        <div class="result-info-row">
                            <span class="result-info-label">Sua parada:</span>
                            <span class="result-info-value" id="result-selected-label"></span>
                        </div>
                        <div class="result-info-row">
                            <span class="result-info-label">Margem de erro:</span>
                            <span class="result-info-value" id="result-margin"></span>
                        </div>
                    </div>
                    <p class="result-distances-title">Distancias detalhadas:</p>
                    <div class="result-distances-grid" id="result-distances-grid"></div>
                    <button class="result-cta-btn" id="result-cta-btn"></button>
                </div>
            </div>`;
        document.body.appendChild(this._resultModal);
        this.elements.push(this._resultModal);

        // DOM refs
        this._timerShell      = this.gameUI.querySelector('#timer-shell');
        this._timerBarFill    = this.gameUI.querySelector('#timer-bar-fill');
        this._timerValue      = this.gameUI.querySelector('#timer-value');
        this._statusMessage   = this.gameUI.querySelector('#status-message');
        this._questionProgress = this.gameUI.querySelector('#question-progress');
        this._inputSource     = null;
        this._stateChip       = null;
        this._livesTrack      = this.gameUI.querySelector('#lives-track');
        this._challengeCard   = this.gameUI.querySelector('#challenge-card');
        this._enunciadoText   = this.gameUI.querySelector('#enunciado-text');
        this._wordTiles       = this.gameUI.querySelector('#word-tiles');
        this._zonasHtml       = this.gameUI.querySelector('#zonas-html');
    }

    // ── Result modal helpers ─────────────────────────────────

    _showResultModal(isCorrect) {
        if (!this._resultModal) return;
        const rp = this.resultPanel;
        const bar    = document.getElementById('result-modal-bar');
        const banner = document.getElementById('result-status-banner');
        const icon   = document.getElementById('result-status-icon');
        const title  = document.getElementById('result-status-title');
        const sub    = document.getElementById('result-status-sub');
        const cLabel = document.getElementById('result-correct-label');
        const sLabel = document.getElementById('result-selected-label');
        const margin = document.getElementById('result-margin');
        const grid   = document.getElementById('result-distances-grid');
        const btn    = document.getElementById('result-cta-btn');
        const confetti = document.getElementById('confetti-container');

        if (!bar) return;

        const cls = isCorrect ? 'is-correct' : 'is-wrong';
        bar.className    = `result-modal-bar ${cls}`;
        banner.className = `result-status-banner ${cls}`;
        icon.className   = `result-status-icon ${cls}`;
        title.className  = `result-status-title ${cls}`;
        sub.className    = `result-status-sub ${cls}`;
        btn.className    = `result-cta-btn ${cls}`;

        icon.textContent  = isCorrect ? '✓' : '✕';
        title.textContent = isCorrect ? 'Acertou em cheio!' : 'Poxa, quase la.';
        sub.textContent   = isCorrect ? '+10 Pontos' : '-1 Vida';

        cLabel.textContent = rp.correctLabel;
        sLabel.textContent = rp.selectedLabel;
        const marginPct = rp.selectedDistance > 0
            ? (rp.selectedDistance / Math.max(1, window.innerWidth) * 100).toFixed(1) + '%'
            : '0%';
        margin.textContent = marginPct;

        const alts = this.questaoAtual?.alternativas ?? [];
        grid.innerHTML = alts.map(alt => {
            const zona = this.zonas.find(z => z.id === alt.id);
            const anchor = this._getPlayerStopAnchor?.() ?? { x: this.player.x };
            const dist = zona ? Math.abs(anchor.x - (zona.x + zona.w / 2)) : 0;
            const pct = (dist / Math.max(1, window.innerWidth) * 100).toFixed(1);
            const isSel = alt.label === rp.selectedLabel;
            return `<div class="result-dist-chip${isSel ? ' is-selected' : ''}">
                <span class="result-dist-label">${alt.label}</span>
                <span class="result-dist-value">${pct}%</span>
            </div>`;
        }).join('');

        btn.textContent = isCorrect ? 'Proxima Fase' : 'Tentar Novamente';

        if (confetti) {
            confetti.innerHTML = '';
            if (isCorrect) {
                const colors = ['hsl(193 95% 73%)', 'hsl(47 96% 62%)', 'hsl(145 64% 58%)', 'hsl(0 0% 100%)', 'hsl(42 98% 62%)'];
                for (let i = 0; i < 28; i++) {
                    const el = document.createElement('div');
                    el.className = 'confetti-piece';
                    el.style.cssText = `left:${Math.random() * 100}%;background:${colors[i % colors.length]};--dur:${(0.9 + Math.random() * 0.8).toFixed(2)}s;--delay:${(Math.random() * 0.5).toFixed(2)}s;transform:rotate(${Math.round(Math.random() * 360)}deg)`;
                    confetti.appendChild(el);
                }
            }
        }

        this._resultModal.classList.remove('hidden');
    }

    _hideResultModal() {
        if (this._resultModal) this._resultModal.classList.add('hidden');
    }

    _atualizarChallengeCard() {
        if (!this._enunciadoText || !this._wordTiles) return;

        // Enunciado
        this._enunciadoText.textContent = this.questaoAtual?.enunciado ?? '';

        // Word tiles — render each letter as an HTML tile
        const word = String(this.currentWord ?? '').trim();
        if (word) {
            this._wordTiles.innerHTML = word.split('').map((char, i) => {
                // First letter shown as "?" until robot passes it (simple reveal on first question)
                const isFirst = (i === 0);
                return `<span class="word-tile${isFirst ? ' word-tile-focus' : ''}">${char}</span>`;
            }).join('');
            this._wordTiles.style.display = 'flex';
        } else {
            this._wordTiles.innerHTML = '';
            this._wordTiles.style.display = 'none';
        }

        if (this._challengeCard) {
            this._challengeCard.style.display = this.questaoAtual ? 'flex' : 'none';
        }
    }

    _atualizarZonasHtml() {
        if (!this._zonasHtml) return;
        const alts = this.questaoAtual?.alternativas ?? [];
        const isCompreensao = this.state === PHASE_STATE.COMPREENSAO;

        if (isCompreensao) {
            this._zonasHtml.innerHTML = `
                <button class="zona-btn zona-btn-compreh" data-zona-id="sabia">💡 Eu sabia!</button>
                <button class="zona-btn zona-btn-compreh" data-zona-id="chutei">🎲 Foi chute</button>`;
        } else {
            this._zonasHtml.innerHTML = alts.map(alt =>
                `<button class="zona-btn" data-zona-id="${alt.id}">${alt.label}</button>`
            ).join('');
        }

        this._zonasHtml.style.display = 'flex';
    }

    _esconderZonasHtml() {
        if (this._zonasHtml) this._zonasHtml.style.display = 'none';
    }


    _renderLivesTrack() {
        return Array.from({ length: 3 }, (_, index) => {
            const lostClass = index < this.lives ? '' : ' is-lost';
            return `<span class="life-chip${lostClass}" aria-hidden="true"></span>`;
        }).join('');
    }

    _getStatusBarMessage() {
        const activeStates = [PHASE_STATE.ESPERA_ATIVA, PHASE_STATE.ESPERA_INCENTIVO, PHASE_STATE.ESPERA_2, PHASE_STATE.COMPREENSAO];
        if (this.state === PHASE_STATE.COMPREENSAO) {
            return 'Pare o robo em "Eu sabia" ou "Foi chute" para registrar a compreensao.';
        }
        if (this.state === PHASE_STATE.FEEDBACK_FINAL) {
            return 'Feedback final em andamento. Observe a demonstracao da resposta correta.';
        }
        if (this.state === PHASE_STATE.FEEDBACK_ERRO) {
            return 'Receba a dica visual e prepare a proxima tentativa.';
        }
        if (activeStates.includes(this.state)) {
            return 'Espaco move e para o robo. Use as setas para trocar a direcao.';
        }
        return 'Acompanhe o desafio e aguarde o proximo passo do jogo.';
    }

    _getInputSourceLabel() {
        if (this.bluetoothInput.isConnecting) return 'Entrada conectando';
        if (this.bluetoothInput.isConnected) return 'Entrada bluetooth';
        return 'Entrada teclado';
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
        this._hideResultModal();
        this._resetarPosicaoRobo();
        if (this._resultPanelTimerId) {
            clearTimeout(this._resultPanelTimerId);
            this._resultPanelTimerId = null;
        }
        this._selecionarPalavraAtual();
        this._atualizarLayoutPalavra();
        this._atualizarChallengeCard();

        const gabarito = this.questaoAtual.alternativas?.find((alt) => alt.id === this.questaoAtual.correta);
        this.logAtual = new QuestionLog(
            window.NEUROBEEP_SESSION_ID || 'SESSAO_TESTE',
            this.phaseNumber,
            this.questaoAtual.id,
            this.questaoAtual.bncc,
            gabarito ? gabarito.id : null
        );
        this.logAtual.marcarExibicao();

        this._mudarEstado(PHASE_STATE.APRESENTACAO);
        this._emitirEstimulo();

        // CORREÇÃO: Usa tauriEmit() no lugar de syncChannel.postMessage()
        tauriEmit('neurobeep_sync', {
            source: 'GAME',
            type: 'SYNC_QUESTION',
            payload: {
                tituloQuestao: this.questaoAtual.enunciado,
                opcoes: this.questaoAtual.alternativas || [],
                questionIndex: this.questaoAtualIndex + 1,
            },
        });
    }

    // ── Máquina de estados ────────────────────────────────────

    _mudarEstado(novoEstado) {
        console.log(`[Estado] ${this.state} → ${novoEstado}`);
        this.state = novoEstado;

        // CORREÇÃO: Usa tauriEmit() no lugar de syncChannel.postMessage()
        tauriEmit('neurobeep_sync', {
            source: 'GAME',
            type: 'SYNC_STATE',
            payload: {
                sessionState: novoEstado.toUpperCase(),
                activeTimer: this.timerIncentivo,
            },
        });
    }

    // 7.1 — Estímulo
    _emitirEstimulo() {
        this._resetarWatchdogs();
        this._gerarZonas();
        this._atualizarZonasHtml();
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
        this.logAtual.registrarTentativa(this.tentativaAtual + 1);
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
        const passoFinal = this._obterPosicaoAtualPassos();
        this.logAtual.registrarRespostaEscolhida(1, zonaId);

        if (!zona) {
            this.logAtual.finalizarJogada(STATUS_RESPOSTA.ERRO_ESPACIAL, null, passoFinal);
            this._processarResultado(STATUS_RESPOSTA.ERRO_ESPACIAL, null);
        } else if (zona.isCorrect) {
            this.logAtual.finalizarJogada(STATUS_RESPOSTA.ACERTO_CONSOLIDADO, zonaId, passoFinal);
            this._iniciarVerificacaoCompreensao();
        } else {
            this.logAtual.finalizarJogada(STATUS_RESPOSTA.ERRO_COGNITIVO, zonaId, passoFinal);
            this._processarResultado(STATUS_RESPOSTA.ERRO_COGNITIVO, zona);
        }
    }

    // 7.3A — Verificação de compreensão
    _iniciarVerificacaoCompreensao() {
        this._mudarEstado(PHASE_STATE.COMPREENSAO);
        this._gerarZonasCompreensao();
        this._atualizarZonasHtml();
        this.reproduzirMidia('compreensao', 'Muito bem! Você SABIA a resposta ou foi um CHUTE?');
    }

    registrarCompreensao(escolha) {
        if (this.state !== PHASE_STATE.COMPREENSAO) return;
        const sabia  = (escolha === 'sabia');
        const status = sabia ? STATUS_RESPOSTA.ACERTO_CONSOLIDADO : STATUS_RESPOSTA.ACERTO_CASUAL;
        this.logAtual.finalizarJogada(status, this.logAtual.resolucao_final.zona_parada, this.logAtual.precisao_odometrica.posicao_final_passos, sabia);
        this.logAtual.marcarInicioFeedback();
        this._salvarLogEEnviarParaRust();
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
        this.logAtual.registrarDicaOferecida();
        this.logAtual.marcarInicioFeedback();
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
        const passoFinal = this._obterPosicaoAtualPassos();
        this.logAtual.registrarRespostaEscolhida(2, zonaId);
        this.logAtual.registrarTentativa(2);

        if (zona?.isCorrect) {
            this.logAtual.finalizarJogada(STATUS_RESPOSTA.ACERTO_ASSISTIDO, zonaId, passoFinal, true);
            this.logAtual.marcarInicioFeedback();
            this._salvarLogEEnviarParaRust();
            this.reproduzirMidia('reforcao_persistencia', 'Muito bem! Com a dica você conseguiu!');
            this.addScore(50);
            this._iniciarEncerramento();
        } else {
            this.logAtual.finalizarJogada(zona ? STATUS_RESPOSTA.ERRO_COGNITIVO : STATUS_RESPOSTA.ERRO_ESPACIAL, zonaId, passoFinal, false);
            this._processarResultadoFinal(zona ? STATUS_RESPOSTA.ERRO_COGNITIVO : STATUS_RESPOSTA.ERRO_ESPACIAL);
        }
    }

    // 7.4D — Resolução final (robô demonstra)
    _processarResultadoFinal(statusFinal) {
        this._mudarEstado(PHASE_STATE.FEEDBACK_FINAL);
        this.movementControl.isMoving = false;
        // Highlight correct answer in HTML
        if (this._zonasHtml) {
            const corretaId = this.questaoAtual?.correta;
            this._zonasHtml.querySelectorAll('.zona-btn').forEach(btn => {
                if (btn.dataset.zonaId === corretaId) btn.classList.add('zona-btn-correct');
                else btn.classList.add('zona-btn-dim');
            });
        }
        if (this.logAtual.resolucao_final.status_resposta_cod !== statusFinal) {
            this.logAtual.finalizarJogada(
                statusFinal,
                this.logAtual.resolucao_final.zona_parada,
                this.logAtual.precisao_odometrica.posicao_final_passos ?? this._obterPosicaoAtualPassos(),
                false
            );
        }
        this.logAtual.marcarInicioFeedback();
        this._salvarLogEEnviarParaRust();
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
        this._hideResultModal();
        if (this.logAtual) {
            this.logAtual.marcarFimFeedback();
            if (this.logAtual._payloadEnviado && this.logsSession.length > 0) {
                this.logsSession[this.logsSession.length - 1] = this.logAtual.toPayload();
            }
        }
        setTimeout(() => this._avancarQuestao(), VICTORY_DISPLAY_MS);
    }

_encerrarFase() {
    const payload = this._gerarPayloadFinal();

    // Dispara a exportação do JSON completo da sessão
    if (window.__TAURI__?.core?.invoke) {
        window.__TAURI__.core.invoke('exportar_sessao')
            .then((caminho) => console.log('[GamePhase] JSON salvo em:', caminho))
            .catch((err) => console.error('[GamePhase] Erro ao exportar sessão:', err));
    }

    this.onPhaseComplete(payload);
}

    // ── Loop de desenho ──────────────────────────────────────

    draw() {
        if (!this.isActive || this.isPaused) return;
        // Canvas only handles: background, lane, player robot, sprite avatar
        this._drawCenario();
        this._drawPlayer();
        this._drawRobotSprite();
        this._atualizarMovimento();
        this._verificarColisoes();
        this._atualizarUI();
        this.checkGameState();

        // Sincroniza posição do robô com dashboard (a cada 2 frames)
        if (frameCount % 2 === 0) {
            tauriEmit('neurobeep_sync', {
                source: 'GAME',
                type: 'SYNC_POSITION',
                payload: {
                    x: this.player.x,
                    normalizedX: this.player.x / width,
                    robotPosition: this._determinarZonaAtual(),
                },
            });
        }

        // Envia frame da miniatura para o dashboard (a cada 4 frames ≈ 15fps)
        this._enviarFrameMiniatura();
    }

    _determinarZonaAtual() {
        if (this.state === PHASE_STATE.COMPREENSAO) return 'COMPREENSAO';
        if (this.player.x < width * 0.3) return 'ZONA_B';
        if (this.player.x > width * 0.7) return 'ZONA_C';
        if (this.player.y < height * 0.3) return 'ZONA_A';
        return 'START';
    }

    _drawCenario() { /* @override */ }

    _drawZonas() {
        const lista = (this.state === PHASE_STATE.COMPREENSAO) ? this.zonasCompreensao : this.zonas;
        for (const z of lista) this._drawZona(z);
    }

    _drawPalavraAtual() {
        // Word tiles are now HTML — see _atualizarChallengeCard
    }

    _drawZona(zona) {
        // Zones are now HTML buttons — canvas zones are invisible hit areas
    }

    _drawPlayer() {
        if (!this.playerSprite) return;
        image(this.playerSprite, this.player.x, this.player.y, this.player.w, this.player.h);
    }

    _drawRobotSprite() {
        const zone = this._getSpriteZone();
        const { x, y, w, h } = zone;

        // Fundo sutil da zona do sprite (zona 4)
        push();
        fill(8, 20, 28, 50);
        noStroke();
        rect(x - 8, y - 8, w + 16, h + 16, 14);
        pop();

        // Speech bubble com feedback — aparece ACIMA do sprite, dentro da zona 4
        if (this.feedbackMessage) this._drawSpeechBubble(x, y, w);

        if (!this.currentRobotAnimation?.image) return;
        this._updateRobotAnimation();
        const frame = this._getRobotCurrentFrame();
        if (!frame) return;
        const transitionAlpha = this._getRobotTransitionAlpha();

        push();
        if (this.previousRobotAnimation?.image && transitionAlpha < 1) {
            const previousFrame = this._getRobotFrame(this.previousRobotAnimation);
            if (previousFrame) {
                tint(255, (1 - transitionAlpha) * 255);
                image(this.previousRobotAnimation.image, x, y, w, h,
                    previousFrame.sx, previousFrame.sy, previousFrame.sw, previousFrame.sh);
            }
        }
        tint(255, transitionAlpha * 255);
        image(this.currentRobotAnimation.image, x, y, w, h,
            frame.sx, frame.sy, frame.sw, frame.sh);
        noTint();
        pop();
    }

    _drawSpeechBubble(spriteX, spriteY, spriteW) {
        const minY = LAYOUT.HUD_H + 8;
        const bubbleW = Math.min(spriteW + 24, width - spriteX - 4);
        const bubbleH = 60;
        const bx = spriteX - 2;
        const by = spriteY - bubbleH - 14;
        if (by < minY) return; // sem espaço, não desenha

        push();
        rectMode(CORNER);
        fill(255, 255, 255, 230);
        stroke(180, 200, 220, 200);
        strokeWeight(1);
        rect(bx, by, bubbleW, bubbleH, 10);

        // Cauda apontando para o sprite
        noStroke();
        fill(255, 255, 255, 230);
        triangle(
            bx + bubbleW * 0.35, by + bubbleH,
            bx + bubbleW * 0.35 + 14, by + bubbleH,
            bx + bubbleW * 0.35 + 7, by + bubbleH + 12
        );

        fill(30, 30, 30);
        textAlign(CENTER, CENTER);
        textSize(13);
        textStyle(NORMAL);
        const linhas = this._quebrarTexto(this.feedbackMessage, bubbleW - 18);
        linhas.forEach((linha, i) => {
            text(linha, bx + bubbleW / 2, by + 16 + i * 19);
        });
        pop();
    }

    _quebrarTexto(txt, largMax) {
        const palavras = String(txt ?? '').split(' ');
        const linhas = []; let atual = '';
        for (const p of palavras) {
            const teste = atual ? `${atual} ${p}` : p;
            if (teste.length * 7 > largMax && atual) { linhas.push(atual); atual = p; }
            else { atual = teste; }
        }
        if (atual) linhas.push(atual);
        return linhas.slice(0, 3);
    }

    _drawHUD() {
        // Enunciado + word badge are drawn by the styled second _drawHUD below
        // This first version is kept as a no-op to avoid duplicate drawing
    }
    _drawResultPanel() {
        // Result panel is now an HTML modal — see _showResultModal / _hideResultModal
    }

    // ── Movimento e colisão ──────────────────────────────────

    _atualizarMovimento() {
        const ok = [PHASE_STATE.ESPERA_ATIVA, PHASE_STATE.ESPERA_INCENTIVO, PHASE_STATE.ESPERA_2, PHASE_STATE.COMPREENSAO];
        if (!ok.includes(this.state)) return;

        if (this.logAtual) {
            this.logAtual.registrarMovimento(this.movementControl.isMoving, this._obterPosicaoAtualPassos());
        }

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
        const zH  = Math.min(68, LAYOUT.ZONAS_H - 20);
        const zW  = Math.min(170, (width - 48) / alts.length - 12);
        const gap = Math.max(10, (width - 32 - alts.length * zW) / (alts.length + 1));
        // Faixa exclusiva: entre área de jogo e rodapé
        const faixaY = height - LAYOUT.RODAPE_H - LAYOUT.ZONAS_H;
        const zY = faixaY + (LAYOUT.ZONAS_H - zH) / 2;
        this.zonas = alts.map((alt, i) => ({
            id: alt.id, label: alt.label,
            x: gap + i * (zW + gap), y: zY, w: zW, h: zH,
            isCorrect: alt.id === this.questaoAtual.correta,
        }));
        const zonaCorreta = this.zonas.find((zona) => zona.isCorrect);
        if (zonaCorreta && this.logAtual) {
            this.logAtual.registrarAlvoEsperado(
                Math.round(zonaCorreta.x),
                Math.round(zonaCorreta.x + zonaCorreta.w)
            );
        }
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

    // Calcula a bounding box exclusiva do sprite (compartilhada por outros métodos)
    _getSpriteZone() {
        const spriteW = Math.min(LAYOUT.SPRITE_W_MAX, width * LAYOUT.SPRITE_W_FRAC);
        const spriteH = spriteW * 1.15;
        const zonaTopoY = LAYOUT.HUD_H + LAYOUT.ENUNCIADO_H + LAYOUT.PALAVRA_BADGE_H + 4;
        const zonaBaseY = height - LAYOUT.ZONAS_H - LAYOUT.RODAPE_H;
        const dispH = zonaBaseY - zonaTopoY;
        const h = Math.min(spriteH, dispH - 8);
        const w = h / 1.15;
        const x = width - w - LAYOUT.SPRITE_GAP;
        const y = zonaTopoY + (dispH - h) / 2;
        return { x, y, w, h };
    }

    // Retorna os limites verticais da zona de jogo (letras + player)
    _getLayoutConstraints() {
        const topY = LAYOUT.HUD_H + LAYOUT.ENUNCIADO_H + LAYOUT.PALAVRA_BADGE_H + 8;
        const botY = height - LAYOUT.ZONAS_H - LAYOUT.RODAPE_H - 8;
        return { topY, botY };
    }

    _atualizarLayoutPalavra() {
        const zone       = this._getSpriteZone();
        const constraints = this._getLayoutConstraints();
        this.wordLayout = generateLinearWordLayout(
            this.currentWord,
            width,
            height,
            { spriteZoneX: zone.x - LAYOUT.SPRITE_GAP, layoutContraints: constraints }
        );
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
        this.player.y = this._getPlayerLaneY();
        this.player.vx = 0;
        this.player.vy = 0;
        this.movementControl.isMoving = false;
        this.movementControl.pendingResolution = false;
    }

    _getPlayerLaneY() {
        // Canvas covers full height; HTML overlays handle top/bottom zones.
        // Player lane sits at ~55% of canvas height.
        return height * 0.55;
    }

    _obterPosicaoAtualPassos() {
        if (Number.isFinite(this.bluetoothInput.rawX)) return this.bluetoothInput.rawX;
        return Math.round(this.player.x);
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
        if (this._inertiaTimerId) { clearTimeout(this._inertiaTimerId); this._inertiaTimerId = null; }
        if (this._timeoutTimerId) { clearTimeout(this._timeoutTimerId); this._timeoutTimerId = null; }
        if (this._timerInterval) { clearInterval(this._timerInterval); this._timerInterval = null; }
    }

_salvarLogEEnviarParaRust() {
    if (!this.logAtual || this.logAtual._payloadEnviado) return;

    const payload = this.logAtual.toPayload();
    this.logsSession.push(payload);
    this.logAtual._payloadEnviado = true;

    // Envia para o Rust via invoke (substitui o postMessage que não chegava)
    if (window.__TAURI__?.core?.invoke) {
        window.__TAURI__.core.invoke('registrar_jogada', { payload })
            .then((msg) => console.log('[GamePhase] Rust confirmou:', msg))
            .catch((err) => console.error('[GamePhase] Erro ao registrar jogada:', err));
    }
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
            logPedagogico: this.logsSession,
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

    _setupRobotSprites() {
        this.robotSprites = {};

        for (const [key, src] of Object.entries(ROBOT_SPRITE_SOURCES)) {
            loadImage(
                src,
                (img) => {
                    this.robotSprites[key] = this._createRobotAnimationState(key, img);
                    if (!this.currentRobotAnimation && key === 'idling') {
                        this._playRobotAnimation('idling');
                    }
                },
                () => {
                    console.warn(`[Robot] Falha ao carregar sprite sheet: ${src}`);
                }
            );
        }

        this.currentRobotAnimationKey = 'idling';
        this.currentRobotAnimation = null;
    }

    _createRobotAnimationState(key, img) {
        const frameWidth = Math.floor(img.width / ROBOT_SPRITE_CONFIG.columns);
        const frameHeight = Math.floor(img.height / ROBOT_SPRITE_CONFIG.rows);
        const frames = [];

        for (let row = 0; row < ROBOT_SPRITE_CONFIG.rows; row += 1) {
            for (let col = 0; col < ROBOT_SPRITE_CONFIG.columns; col += 1) {
                frames.push({
                    sx: col * frameWidth,
                    sy: row * frameHeight,
                    sw: frameWidth,
                    sh: frameHeight,
                });
            }
        }

        return {
            key,
            image: img,
            frames,
            frameIndex: 0,
            lastFrameAt: 0,
            frameDurationMs: 1000 / ROBOT_SPRITE_CONFIG.fps,
            loop: false,
            isPlaying: false,
            onEnded: null,
        };
    }

    _playRobotAnimation(key, onEnded) {
        const animation = this.robotSprites[key];
        if (!animation?.frames?.length) return false;

        const previousAnimation = this.currentRobotAnimation && this.currentRobotAnimation !== animation
            ? { ...this.currentRobotAnimation }
            : null;

        for (const other of Object.values(this.robotSprites)) {
            other.isPlaying = false;
            other.onEnded = null;
        }

        animation.frameIndex = 0;
        animation.lastFrameAt = millis();
        animation.isPlaying = true;
        animation.onEnded = onEnded ?? null;
        animation.loop = typeof onEnded !== 'function' && key === 'idling';
        this.currentRobotAnimationKey = key;
        this.currentRobotAnimation = animation;
        this.previousRobotAnimation = previousAnimation;
        this.robotTransition = previousAnimation ? { startedAt: millis() } : null;
        return true;
    }

    _updateRobotAnimation() {
        const animation = this.currentRobotAnimation;
        if (!animation?.isPlaying) return;

        const now = millis();
        if (now - animation.lastFrameAt < animation.frameDurationMs) return;

        const elapsedFrames = Math.max(1, Math.floor((now - animation.lastFrameAt) / animation.frameDurationMs));
        animation.lastFrameAt = now;

        for (let i = 0; i < elapsedFrames; i += 1) {
            if (animation.frameIndex < animation.frames.length - 1) {
                animation.frameIndex += 1;
                continue;
            }

            if (animation.loop) {
                animation.frameIndex = 0;
                continue;
            }

            animation.isPlaying = false;
            const ended = animation.onEnded;
            animation.onEnded = null;
            if (typeof ended === 'function') ended();
            break;
        }
    }

    _getRobotCurrentFrame() {
        const animation = this.currentRobotAnimation;
        if (!animation?.frames?.length) return null;
        return animation.frames[animation.frameIndex] ?? animation.frames[0];
    }

    _getRobotFrame(animation) {
        if (!animation?.frames?.length) return null;
        return animation.frames[animation.frameIndex] ?? animation.frames[0];
    }

    _getRobotTransitionAlpha() {
        if (!this.robotTransition) return 1;
        const elapsed = millis() - this.robotTransition.startedAt;
        const alpha = constrain(elapsed / ROBOT_SPRITE_CONFIG.transitionMs, 0, 1);
        if (alpha >= 1) {
            this.robotTransition = null;
            this.previousRobotAnimation = null;
            return 1;
        }
        return alpha;
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
            const started = this._playRobotAnimation(key, () => {
                if (index < sequence.length) {
                    next();
                    return;
                }
                this._playRobotAnimation('idling');
            });
            if (!started) {
                if (index < sequence.length) {
                    next();
                    return;
                }
                this._playRobotAnimation('idling');
            }
        };

        next();
    }

    _playRobotSequenceByTipo(tipo) {
        const animationByTipo = {
            reforcao_positivo: 'right',
            explicacao_conteudo: 'talking',
            incentivo: 'talking',
            engajamento: 'talking',
            alerta_execucao: 'talking',
            orientacao_espacial: 'talking',
            scaffolding: 'wrong',
            reforcao_persistencia: 'right',
            erro_cognitivo_reincidente: 'wrong',
            resolucao: 'wrong',
            compreensao: 'talking',
        };
        const animationKey = animationByTipo[tipo] ?? 'talking';
        this._playRobotSequence([animationKey]);
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

        // Barra de timer via DOM — fica acima do canvas (z-index 100)
        if (this._timerBarTrack && this._timerBarFill) {
            if (this.showTimerBadge && this.timerIncentivo > 0) {
                const TIMEOUT_S = TIMEOUT_DURATION_MS / 1000;
                const pct = Math.max(0, (this.timerIncentivo / TIMEOUT_S) * 100).toFixed(1);
                this._timerBarTrack.style.display = 'block';
                this._timerBarFill.style.width = pct + '%';
            } else {
                this._timerBarTrack.style.display = 'none';
                this._timerBarFill.style.width = '100%';
            }
        }
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
            this._hideResultModal();
        }
    }

    _resolverParadaPorProximidade() {
        const isCompreensao = this.state === PHASE_STATE.COMPREENSAO;
        const zonasAtivas = isCompreensao ? this.zonasCompreensao : this.zonas;
        if (!Array.isArray(zonasAtivas) || !zonasAtivas.length) return;

        const playerAnchor = this._getPlayerStopAnchor();
        const metrics = zonasAtivas.map((z) => {
            const zonaCentroX = z.x + z.w / 2;
            const distanceX = Math.abs(playerAnchor.x - zonaCentroX);
            return {
                zona: z,
                distanceX,
                overlaps: this._isPlayerWithinZoneTolerance(playerAnchor.x, z),
            };
        }).sort((a, b) => a.distanceX - b.distanceX);

        const maisProxima = metrics[0];
        const correta = zonasAtivas.find(z => z.isCorrect) ?? maisProxima?.zona ?? null;
        const distCorreta = correta
            ? Math.abs(playerAnchor.x - (correta.x + correta.w / 2))
            : maisProxima.distanceX;

        const zonaSelecionada = isCompreensao
            ? maisProxima?.zona ?? null
            : (maisProxima?.overlaps ? maisProxima.zona : null);

        this.resultPanel.visible = false; // not used for drawing anymore
        this.resultPanel.selectedLabel = zonaSelecionada?.label ?? 'Zona neutra';
        this.resultPanel.selectedDistance = maisProxima.distanceX;
        this.resultPanel.correctLabel = correta?.label ?? '—';
        this.resultPanel.correctDistance = distCorreta;
        this.resultPanel.proximityLabel = this._classificarProximidade(distCorreta);
        this.resultPanel.interOptionDistances = this._calcularDistanciasEntreOpcoes(zonasAtivas);

        const isModalCorrect = zonaSelecionada?.isCorrect === true;
        this._showResultModal(isModalCorrect);

        this.movementControl.pendingResolution = true;
        if (this._resultPanelTimerId) clearTimeout(this._resultPanelTimerId);
        this._resultPanelTimerId = setTimeout(() => {
            this.movementControl.pendingResolution = false;
            this._hideResultModal();
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

    _getPlayerStopAnchor() {
        return {
            x: this.player.x + this.player.w / 2,
            y: this.player.y + this.player.h / 2,
        };
    }

    _isPlayerWithinZoneTolerance(playerAnchorX, zona) {
        const tolerance = Math.max(16, Math.min(36, zona.w * 0.2));
        return playerAnchorX >= (zona.x - tolerance) && playerAnchorX <= (zona.x + zona.w + tolerance);
    }

    _classificarProximidade(distancePx) {
        if (distancePx <= 18) return 'Excelente (muito próximo)';
        if (distancePx <= 36) return 'Bom (próximo)';
        if (distancePx <= 64) return 'Regular (distância média)';
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

    _drawCenario() {
        background(10, 22, 36);

        const laneY = this._getPlayerLaneY() + this.player.h * 0.48;
        const zone  = this._getSpriteZone();

        push();
        noStroke();

        // Lane track
        fill(255, 255, 255, 8);
        rect(20, laneY - 18, width - 40, 36, 18);
        fill(6, 20, 32, 90);
        rect(44, laneY - 7, width - 88, 14, 999);

        // Sprite area bg
        fill(8, 20, 30, 60);
        rect(zone.x - 10, zone.y - 10, zone.w + 20, zone.h + 20, 14);

        pop();
    }

        _drawVerticalGradient(fromColor, toColor, x, y, w, h) {
        push();
        noFill();
        for (let i = 0; i < h; i += 2) {
            const amount = constrain(i / Math.max(1, h), 0, 1);
            stroke(lerpColor(fromColor, toColor, amount));
            line(x, y + i, x + w, y + i);
        }
        pop();
    }

    _drawPalavraAtual() {
        if (!this.currentWord || !this.wordLayout.letters.length) return;

        push();
        rectMode(CORNER);
        textAlign(CENTER, CENTER);
        textStyle(BOLD);

        for (const letter of this.wordLayout.letters) {
            const tileX = letter.x - 4;
            const tileY = letter.y - 6;
            const tileW = letter.size + 8;
            const tileH = letter.size + 14;

            // Shadow
            fill(0, 0, 0, 60);
            noStroke();
            rect(tileX + 3, tileY + 5, tileW, tileH, 14);

            // Tile body — dark teal card
            stroke(100, 200, 220, 50);
            strokeWeight(1.5);
            fill(14, 55, 72, 230);
            rect(tileX, tileY, tileW, tileH, 14);

            // Shine
            noStroke();
            fill(255, 255, 255, 15);
            rect(tileX + 3, tileY + 3, tileW - 6, tileH * 0.32, 12);

            // Letter
            fill(255);
            textSize(letter.size * 0.66);
            text(letter.char, letter.x + letter.size / 2, letter.y + letter.size / 2 + 3);
        }
        pop();
    }

        _drawZona(zona) {
        const isCompreensao    = this.state === PHASE_STATE.COMPREENSAO;
        const isResolvedCorrect = zona.isCorrect && this.state === PHASE_STATE.FEEDBACK_FINAL;

        push();
        rectMode(CORNER);

        // Shadow
        noStroke();
        fill(0, 0, 0, 55);
        rect(zona.x + 2, zona.y + 6, zona.w, zona.h, 18);

        // Card fill
        const fillAlpha = 210;
        if (isResolvedCorrect)      fill(68, 200, 120, fillAlpha);
        else if (isCompreensao)     fill(200, 160, 40, fillAlpha);
        else                        fill(20, 90, 120, fillAlpha);

        stroke(255, 255, 255, 35);
        strokeWeight(1.5);
        rect(zona.x, zona.y, zona.w, zona.h, 18);

        // Shine strip
        noStroke();
        fill(255, 255, 255, 22);
        rect(zona.x + 3, zona.y + 3, zona.w - 6, zona.h * 0.33, 14);

        // Label
        if (isCompreensao)      fill(60, 40, 10);
        else if (isResolvedCorrect) fill(20, 50, 30);
        else                    fill(255);

        textAlign(CENTER, CENTER);
        textStyle(BOLD);
        textSize(isCompreensao ? 20 : 26);
        text(zona.label, zona.x + zona.w / 2, zona.y + zona.h / 2 + 1);
        pop();
    }

        _drawSpeechBubble(spriteX, spriteY, spriteW) {
        const minY = LAYOUT.HUD_H + 8;
        const bubbleW = Math.min(Math.max(190, spriteW + 40), width - spriteX - 6);
        const lines = this._quebrarTexto(this.feedbackMessage, bubbleW - 30);
        const bubbleH = Math.max(68, 34 + lines.length * 18);
        const bx = spriteX - 6;
        const by = spriteY - bubbleH - 18;

        if (by < minY) return;

        push();
        rectMode(CORNER);
        stroke(255, 255, 255, 120);
        strokeWeight(1.4);
        fill(this.feedbackColor[0], this.feedbackColor[1], this.feedbackColor[2], 228);
        rect(bx, by, bubbleW, bubbleH, 18);

        noStroke();
        triangle(
            bx + bubbleW * 0.36,
            by + bubbleH,
            bx + bubbleW * 0.36 + 16,
            by + bubbleH,
            bx + bubbleW * 0.36 + 8,
            by + bubbleH + 12
        );

        fill(19, 24, 29);
        textAlign(CENTER, CENTER);
        textStyle(BOLD);
        textSize(13);
        lines.forEach((lineText, index) => {
            text(lineText, bx + bubbleW / 2, by + 22 + index * 18);
        });
        pop();
    }

    _drawHUD() {
        // All HUD/enunciado/word rendering is now HTML — canvas is clean
    }

        _drawResultPanel() {
        // Result panel is now an HTML modal — see _showResultModal / _hideResultModal
    }

    _gerarZonas() {
        if (!this.questaoAtual?.alternativas) return;
        const alts = this.questaoAtual.alternativas;
        // Invisible hit zones — same horizontal layout as HTML buttons
        const zH  = 64;
        const zW  = Math.min(200, (width - 64) / alts.length - 16);
        const gap = Math.max(16, (width - 32 - alts.length * zW) / (alts.length + 1));
        // Place at lane level so proximity detection works
        const zY  = this._getPlayerLaneY() - zH / 2;

        this.zonas = alts.map((alt, index) => ({
            id: alt.id,
            label: alt.label,
            x: gap + index * (zW + gap),
            y: zY,
            w: zW,
            h: zH,
            isCorrect: alt.id === this.questaoAtual.correta,
        }));

        const zonaCorreta = this.zonas.find(z => z.isCorrect);
        if (zonaCorreta && this.logAtual) {
            this.logAtual.registrarAlvoEsperado(
                Math.round(zonaCorreta.x),
                Math.round(zonaCorreta.x + zonaCorreta.w)
            );
        }
    }

    _getSpriteZone() {
        const spriteW = Math.min(LAYOUT.SPRITE_W_MAX, width * LAYOUT.SPRITE_W_FRAC);
        const spriteH = spriteW * 1.16;
        const h = Math.min(spriteH, height * 0.28);
        const w = h / 1.16;
        const x = width - w - LAYOUT.SPRITE_GAP;
        const y = height * 0.34 - h / 2;
        return { x, y, w, h };
    }

    _getLayoutConstraints() {
        const topY = LAYOUT.HUD_H + 16;
        const botY = height - LAYOUT.RODAPE_H - 22;
        return { topY, botY };
    }

    _gerarZonasCompreensao() {
        const zW = Math.min(220, (width - 96) / 2);
        const zH = 88;
        const gap = 24;
        const totalWidth = zW * 2 + gap;
        const startX = (width - totalWidth) / 2;
        const y = height - LAYOUT.RODAPE_H - LAYOUT.ZONAS_H - 100;

        this.zonasCompreensao = [
            { id: 'sabia', label: 'Eu sabia', x: startX, y, w: zW, h: zH },
            { id: 'chutei', label: 'Foi chute', x: startX + zW + gap, y, w: zW, h: zH },
        ];
    }

    _getPlayerLaneY() {
        const topY = LAYOUT.HUD_H + LAYOUT.ENUNCIADO_H + LAYOUT.PALAVRA_BADGE_H + 24;
        const botY = height - LAYOUT.ZONAS_H - LAYOUT.RODAPE_H - 46;
        return topY + (botY - topY) * 0.54;
    }

    _getStateLabel() {
        return String(this.state ?? 'idle').replaceAll('_', ' ');
    }

    _atualizarUI() {
        const el = id => document.getElementById(id);

        if (el('score-value')) el('score-value').textContent = `${this.score} pts`;
        if (el('phase-value')) el('phase-value').textContent = `Fase ${this.phaseNumber}`;
        if (this._livesTrack)  this._livesTrack.innerHTML = this._renderLivesTrack();
        if (this._questionProgress)
            this._questionProgress.textContent = `${Math.max(1, this.questaoAtualIndex + 1)}/${this.questoes.length}`;
        if (this._statusMessage)
            this._statusMessage.textContent = this._getStatusBarMessage();

        if (this._timerShell && this._timerBarFill) {
            if (this.showTimerBadge && this.timerIncentivo > 0) {
                const pct = Math.max(0, (this.timerIncentivo / (TIMEOUT_DURATION_MS / 1000)) * 100).toFixed(1);
                this._timerShell.classList.add('is-visible');
                this._timerBarFill.style.width = `${pct}%`;
                if (this._timerValue) this._timerValue.textContent = `${this.timerIncentivo}s`;
            } else {
                this._timerShell.classList.remove('is-visible');
                this._timerBarFill.style.width = '100%';
                if (this._timerValue) this._timerValue.textContent = `${TIMEOUT_DURATION_MS / 1000}s`;
            }
        }
    }

    _alternarMovimentoComEspaco() {
        const estadosAtivos = [PHASE_STATE.ESPERA_ATIVA, PHASE_STATE.ESPERA_INCENTIVO, PHASE_STATE.ESPERA_2, PHASE_STATE.COMPREENSAO];
        if (!estadosAtivos.includes(this.state)) return;
        if (this.movementControl.pendingResolution) return;

        this.movementControl.isMoving = !this.movementControl.isMoving;
        this.feedbackMessage = this.movementControl.isMoving
            ? `Buscando resposta ${this.movementControl.direction > 0 ? 'a frente' : 'de volta'}`
            : 'Robo parado para avaliacao';
        this.feedbackColor = this.movementControl.isMoving ? [188, 244, 255] : [255, 228, 164];

        if (!this.movementControl.isMoving) {
            this._resolverParadaPorProximidade();
        } else {
            this.resultPanel.visible = false;
            this._hideResultModal();
        }
    }

    cleanup() {
        super.cleanup();
        this._limparTimers();
        this._hideResultModal();
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
        for (const animation of Object.values(this.robotSprites)) {
            animation.isPlaying = false;
            animation.onEnded = null;
        }
        this.robotSprites = {};
        this.currentRobotAnimation = null;
        this.currentRobotAnimationKey = null;
        this.previousRobotAnimation = null;
        this.robotTransition = null;
        if (this.gameUI?.parentNode) this.gameUI.parentNode.removeChild(this.gameUI);
        this.sprites = []; this.zonas = []; this.logsSession = [];
        // Para o loop de captura de frames da miniatura
        this._frameLoopAtivo = false;
    }

    // ── Atalhos de constantes ────────────────────────────────

    get STATUS()  { return STATUS_RESPOSTA; }
    get ESTADOS() { return PHASE_STATE; }
}