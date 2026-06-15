// GamePhase.js
// ============================================================
//  GamePhase — orquestrador da fase de jogo do NeuroBeep.
//
//  Responsabilidades (apenas):
//    • Ciclo de vida da cena (setup / draw / cleanup)
//    • Máquina de estados pedagógica
//    • Movimento e física do player (modo teclado e modo BLE)
//    • Geração de zonas e cálculo de proximidade na parada
//    • Delegação à GameUI (HTML), RobotSprite (canvas) e GameBridge (hardware)
//
//  Para criar uma nova fase, estenda GamePhase e implemente initializePhase():
//
//    export class MinhaFase extends GamePhase {
//        constructor() { super('Meu Tema', 1); }
//
//        initializePhase() {
//            this.questoes = [ ...minhasQuestoes ];
//            loadImage('assets/player.png',
//                img => { this.playerSprite = img; this.iniciarRoteiro(); },
//                ()  => this.iniciarRoteiro()
//            );
//        }
//    }
// ============================================================

import { Scene }        from './Scene.js';
import { GameBridge }   from './GameBridge.js';
import { GameUI }       from './GameUI.js';
import { RobotSprite }  from './RobotSprite.js';
import { QuestionLog, STATUS_RESPOSTA, PHASE_STATE } from './QuestionLog.js';
import { generateLinearWordLayout, selectRandomElement } from './utils.js';
import { AudioNarrator } from './AudioNarrator.js';
import { ThemeManager } from './ThemeManager.js';

// ── Constantes internas ─────────────────────────────────────
const TIMING = {
    INERTIA_TRIGGER:  15_000,
    TIMEOUT_DURATION: 60_000,
    VICTORY_DISPLAY:   5_000,  // era 3 s — aumentado para público infantil
    RESULT_PANEL:      4_000,  // era 2.2 s — mais tempo para ler o resultado
    SECOND_TRY_DELAY:  4_000,
    DEMO_TIMEOUT:      6_000,
    DEMO_TOLERANCE:       80,
};

const LAYOUT = {
    HUD_H:         76,
    RODAPE_H:      52,
    SPRITE_W_MAX: 180,
    SPRITE_W_FRAC: 0.14,
    SPRITE_GAP:    16,
};

const ESTADOS_ATIVOS = new Set([
    PHASE_STATE.ESPERA_ATIVA,
    PHASE_STATE.ESPERA_INCENTIVO,
    PHASE_STATE.ESPERA_2,
    PHASE_STATE.COMPREENSAO,
]);

// ── Mapeamento de feedback para mídia ───────────────────────
const FEEDBACK_MIDIA = {
    [STATUS_RESPOSTA.OMISSAO_TIMEOUT]: ['engajamento',         'O robô está esperando, vamos tentar?'],
    [STATUS_RESPOSTA.ERRO_EXECUCAO]:   ['alerta_execucao',     'Cuidado, precisa parar o robô na hora certa!'],
    [STATUS_RESPOSTA.ERRO_ESPACIAL]:   ['orientacao_espacial', 'Você parou no meio do caminho!'],
    [STATUS_RESPOSTA.ERRO_COGNITIVO]:  ['scaffolding',         'Não é essa. Preste atenção na dica...'],
};

// ============================================================
export class GamePhase extends Scene {

    constructor(name, phaseNumber) {
        super(name);

        this.phaseNumber = phaseNumber;
        this.score       = 0;
        this.lives       = 3;
        this.isPaused    = false;

        // ── Roteiro ──────────────────────────────────────────
        /** @type {import('./GameBridge.js').Questao[]} */
        this.questoes          = [];
        this.questaoAtualIndex = -1;
        this.questaoAtual      = null;

        // ── Logs ─────────────────────────────────────────────
        /** @type {QuestionLog|null} */ this.logAtual    = null;
        this.logsSession = [];

        // ── Máquina de estados ───────────────────────────────
        this.state          = PHASE_STATE.IDLE;
        this.tentativaAtual = 0;

        // ── Watchdogs ────────────────────────────────────────
        this._inertiaTimerId    = null;
        this._timeoutTimerId    = null;
        this._timerInterval     = null;
        this._finalResultTimerId = null;
        this.timerIncentivo     = 0;
        this.showTimerBadge     = false;

        // ── Zonas ────────────────────────────────────────────
        this.zonas            = [];
        this.zonasCompreensao = [];

        // ── Player ───────────────────────────────────────────
        this.playerSprite    = null;
        this.player          = { x: 50, y: 0, w: 80, h: 80, vx: 0, vy: 0 };
        this.movementControl = { isMoving: false, direction: 1, speed: 6, pendingResolution: false };

        // ── Palavra pedagógica ───────────────────────────────
        this.currentWord = '';
        this.wordLayout  = { letters: [], spacing: 0, lineY: 0, totalWidth: 0 };

        // ── Painel de resultado ──────────────────────────────
        this._resultPanel = {
            visible: false, selectedLabel: '—', selectedDistance: 0,
            correctLabel: '—', correctDistance: 0,
        };
        this._resultPanelTimerId = null;

        // ── Feedback do robô tutor ───────────────────────────
        this.feedbackMessage = '';
        this.feedbackColor   = [255, 255, 255];

        // ── Demo da resposta correta ─────────────────────────
        this._demoAtivo      = false;
        this._demoStepAlvo   = 0;
        this._demoTimeoutId  = null;

        // ── BLE (entrada do carrinho real) ───────────────────
        this.robotInput = { rawX: null, lastPacketAt: 0 };

        // ── Recalibração HEG em jogo ──────────────────────────
        // Salva o estado antes da recalibração para restaurar depois.
        this._estadoAntesDaRecalibracao = null;
        this._avancoEmAndamento         = false;

        // ── Colaboradores ────────────────────────────────────
        this.bridge = new GameBridge();
        this.ui     = new GameUI(phaseNumber);
        this.robot  = new RobotSprite();

        // Handlers de cleanup do bridge
        this._offTelemetry = null;
        this._offHegStop   = null;
        this._offHegResume = null;
        this._offCommand   = null;

        this._globalKeydownHandler = null;
    }

    // ──────────────────────────────────────────────────────────
    //  CICLO DE VIDA
    // ──────────────────────────────────────────────────────────

    setup() {
        super.setup();
        this.ui.mount();
        this.robot.setup();
        this._instalarControlesGlobais();

        // initializePhase() roda imediatamente — define questoes[] e chama
        // loadImage() + iniciarRoteiro(). Não precisa esperar o bridge.
        this.initializePhase();

        // Handlers de BLE registrados em paralelo, de forma não-bloqueante.
        // Se o Tauri não estiver disponível, o jogo continua em modo teclado.
        this.bridge.init()
            .then(() => this._registrarHandlersBridge())
            .catch(() => {/* sem Tauri — modo teclado ativo */});
    }

    /** @override Subclasses definem questoes[] e chamam iniciarRoteiro(). */
    initializePhase() {}

    cleanup() {
        super.cleanup();
        this._limparTimers();
        this.ui.hideResultModal();
        this.ui.unmount();
        this.robot.dispose();

        if (this._resultPanelTimerId) { clearTimeout(this._resultPanelTimerId); this._resultPanelTimerId = null; }
        if (this._demoTimeoutId)      { clearTimeout(this._demoTimeoutId);      this._demoTimeoutId      = null; }
        if (this._globalKeydownHandler) {
            document.removeEventListener('keydown', this._globalKeydownHandler);
            this._globalKeydownHandler = null;
        }

        this._offTelemetry?.();
        this._offHegStop?.();
        this._offHegResume?.();
        this._offCommand?.();
        this._avancoEmAndamento = false;
        this.bridge.dispose();
    }

    // ──────────────────────────────────────────────────────────
    //  BRIDGE — hardware + dashboard
    // ──────────────────────────────────────────────────────────

    _registrarHandlersBridge() {
        this._offTelemetry = this.bridge.onTelemetry(({ steps, velMedia, odomX }) => {
            this.robotInput.rawX        = steps;
            this.robotInput.lastPacketAt = Date.now();
            this.logAtual?.registrarMovimento(this.movementControl.isMoving, steps);
            this.player.x = this.bridge.stepsToPixelX(steps, width, this.player.w);
            this.bridge.updateBleDebugHud({ odomX, steps, vel: velMedia, playerX: this.player.x });

            if (this._demoAtivo && Math.abs(steps - this._demoStepAlvo) <= TIMING.DEMO_TOLERANCE) {
                this._demoAtivo = false;
                this.bridge.sendCommand('VEL:0');
                console.log('[Demo] ✅ Alvo atingido.');
            }
        });

        this._offHegStop = this.bridge.onHegStop(() => {
            // Só processa parada em estados ativos (ESPERA_ATIVA/2/INCENTIVO/COMPREENSAO).
            // Fora deles o robô pode estar em homing ou feedback — não interrompe.
            if (!ESTADOS_ATIVOS.has(this.state)) return;
            this.bridge.sendCommand('VEL:0 0');
            this.movementControl.isMoving = false;
            this.feedbackMessage = 'Concentração detectada — robô parado';
            this.feedbackColor   = [80, 220, 100];
            this._resolverParadaPorProximidade();
        });
        // Escuta os comandos vindos do Painel do Mediador (React/Tauri)
        this._offCommand = this.bridge.onCommand((cmd) => {
            if (cmd === 'PROXIMA_QUESTAO') {
                this.avancarParaProximaQuestao();
            } else if (cmd === 'SEGUNDA_CHANCE') {
                this._liberarSegundaTentativaComBotao();
            } else if (cmd === 'LIBERAR_COMPREENSAO') {
                this._liberarCompreensaoComBotao();
            } else if (cmd === 'INICIAR_RECALIBRACAO') {
                this._iniciarRecalibracao();
            } else if (cmd === 'RETOMAR_APOS_RECALIBRACAO') {
                this._retomadaAposRecalibracao();
            }
        });

        this._offHegResume = this.bridge.onHegResume(() => {
            this._resultPanel.visible = false;
            this.ui.hideResultModal();

            if (this.state === PHASE_STATE.ENCERRAMENTO) {
                this.bridge.sendCommand('VOLTA_ZERO');
                this._mudarEstado(PHASE_STATE.AGUARDANDO_PROXIMA);
            }
            // FEEDBACK_ERRO removido: 2ª tentativa agora inicia pelo botão "Segunda Chance"
            else if (this.state === PHASE_STATE.ESPERA_2) {
                this.bridge.sendCommand('FOLLOW_LINE_START');
            }
        });
    }

    // ──────────────────────────────────────────────────────────
    //  LOOP DE DESENHO
    // ──────────────────────────────────────────────────────────

    draw() {
        if (!this.isActive || this.isPaused) return;

        this._drawCenario();
        this._drawPlayer();

        const spriteZone = this._getSpriteZone();
        this.robot.draw(spriteZone.x, spriteZone.y, spriteZone.w, spriteZone.h, this.feedbackMessage, this.feedbackColor);

        this._atualizarMovimento();
        this._atualizarUI();
        this.checkGameState();

        if (frameCount % 2 === 0) {
            this.bridge.syncPosition({
                x: this.player.x, normalizedX: this.player.x / width,
                robotPosition: this._determinarZonaAtual(),
            });
        }
        this.bridge.sendFrameTick();
    }

    // ──────────────────────────────────────────────────────────
    //  ROTEIRO
    // ──────────────────────────────────────────────────────────

    iniciarRoteiro() {
        if (!this.questoes.length) { console.warn('[GamePhase] Roteiro vazio.'); return; }
        this.questaoAtualIndex = -1;
        this._avancarQuestao();
    }

    _avancarQuestao(targetIndex = null) {
        this.questaoAtualIndex = targetIndex !== null ? targetIndex : this.questaoAtualIndex + 1;

        if (this.questaoAtualIndex >= this.questoes.length) { this._encerrarFase(); return; }

        this.questaoAtual = this.questoes[this.questaoAtualIndex];
        this.tentativaAtual = 0;
        this.zonas = []; this.zonasCompreensao = [];
        this.feedbackMessage = '';
        this._resultPanel.visible = false;
        this.ui.hideResultModal();
        this._resetarPosicaoRobo();
        if (this._resultPanelTimerId) { clearTimeout(this._resultPanelTimerId); this._resultPanelTimerId = null; }

        this._selecionarPalavraAtual();
        this._atualizarLayoutPalavra();
        this.ui.updateChallengeCard(this.questaoAtual.enunciado, this.currentWord);

        const gabarito = this.questaoAtual.alternativas?.find(a => a.id === this.questaoAtual.correta);
        this.logAtual = new QuestionLog(
            window.NEUROBEEP_SESSION_ID || 'SESSAO_TESTE',
            this.phaseNumber, this.questaoAtual.id, this.questaoAtual.bncc, gabarito?.id ?? null
        );
        this.logAtual.marcarExibicao();

        this._mudarEstado(PHASE_STATE.APRESENTACAO);
        this._emitirEstimulo();
        this.bridge.syncQuestion({
            tituloQuestao: this.questaoAtual.enunciado,
            opcoes: this.questaoAtual.alternativas ?? [],
            questionIndex: this.questaoAtualIndex + 1,
        });
    }

    // ──────────────────────────────────────────────────────────
    //  MÁQUINA DE ESTADOS
    // ──────────────────────────────────────────────────────────

    _mudarEstado(novoEstado) {
        console.log(`[Estado] ${this.state} → ${novoEstado}`);
        this.state = novoEstado;
        this.bridge.syncState({ sessionState: novoEstado.toUpperCase(), activeTimer: this.timerIncentivo });
    }

    // 7.1 — Estímulo inicial
    _emitirEstimulo() {
        this._resetarWatchdogs();
        this._gerarZonas();
        this.ui.updateZones(this.questaoAtual.alternativas, this.state, this.questaoAtual.correta);
        this._mudarEstado(PHASE_STATE.ESPERA_ATIVA);
        this.reproduzirAudioQuestao(this.questaoAtual);
        this._inertiaTimerId = setTimeout(() => this._ativarModoIncentivo(), TIMING.INERTIA_TRIGGER);
    }

    // 7.2 — Watchdog de inércia
    _ativarModoIncentivo() {
        if (this.state !== PHASE_STATE.ESPERA_ATIVA && this.state !== PHASE_STATE.ESPERA_2) return;
        this._mudarEstado(PHASE_STATE.ESPERA_INCENTIVO);
        this.showTimerBadge = true;
        this.timerIncentivo = TIMING.TIMEOUT_DURATION / 1000;
        this.reproduzirMidia('incentivo', 'Vamos lá, você consegue!');
        this._timerInterval  = setInterval(() => { this.timerIncentivo -= 1; if (this.timerIncentivo <= 0) this._onTimeout(); }, 1_000);
        this._timeoutTimerId = setTimeout(() => this._onTimeout(), TIMING.TIMEOUT_DURATION);
    }

    _onTimeout() {
        if (this.state !== PHASE_STATE.ESPERA_INCENTIVO) return;
        this._limparTimers();
        this.logAtual.registrarTentativa(this.tentativaAtual + 1);
        this.tentativaAtual < 1
            ? this._processarResultado(STATUS_RESPOSTA.OMISSAO_TIMEOUT)
            : this._processarResultadoFinal(STATUS_RESPOSTA.OMISSAO_TIMEOUT);
    }

    // 7.3 — 1ª tentativa
    registrarInteracao(zonaId) {
        if (this.state !== PHASE_STATE.ESPERA_ATIVA && this.state !== PHASE_STATE.ESPERA_INCENTIVO) return;
        this._limparTimers();
        this.showTimerBadge = false;
        this.tentativaAtual++;
        this._mudarEstado(PHASE_STATE.DECISAO_1);

        const zona = this._encontrarZona(zonaId);
        const passoFinal = this._posicaoAtualPassos();
        this.logAtual.registrarRespostaEscolhida(1, zonaId);

        if (!zona) {
            this.logAtual.finalizarJogada(STATUS_RESPOSTA.ERRO_ESPACIAL, null, passoFinal);
            this._processarResultado(STATUS_RESPOSTA.ERRO_ESPACIAL);
        } else if (zona.isCorrect) {
            this.logAtual.finalizarJogada(STATUS_RESPOSTA.ACERTO_CONSOLIDADO, zonaId, passoFinal);
            this._iniciarVerificacaoCompreensao();
        } else {
            this.logAtual.finalizarJogada(STATUS_RESPOSTA.ERRO_COGNITIVO, zonaId, passoFinal);
            this._processarResultado(STATUS_RESPOSTA.ERRO_COGNITIVO);
        }
    }

    // 7.3A — Verificação de compreensão
    _iniciarVerificacaoCompreensao() {
        this._resultPanel.visible = false;
        this.ui.hideResultModal();

        // Envia robô para home e aguarda mediador liberar antes do aluno marcar
        this.bridge.sendCommand('VOLTA_ZERO');
        this._gerarZonasCompreensao(); // zonas prontas para quando o robô voltar

        this._mudarEstado(PHASE_STATE.AGUARDANDO_COMPREENSAO);
        this.reproduzirMidia('compreensao', 'Muito bem! Você SABIA a resposta ou foi um CHUTE?');
    }

    // Acionado pelo botão "Liberar Compreensão" do mediador
    _liberarCompreensaoComBotao() {
        if (this.state !== PHASE_STATE.AGUARDANDO_COMPREENSAO) return;
        this.bridge.sendCommand('FOLLOW_LINE_START');
        this._mudarEstado(PHASE_STATE.COMPREENSAO);
        this.ui.updateZones([], PHASE_STATE.COMPREENSAO, null);
    }

    registrarCompreensao(escolha) {
        if (this.state !== PHASE_STATE.COMPREENSAO) return;
        const sabia  = (escolha === 'sabia');
        const status = sabia ? STATUS_RESPOSTA.ACERTO_CONSOLIDADO : STATUS_RESPOSTA.ACERTO_CASUAL;
        this.logAtual.finalizarJogada(status, this.logAtual.resolucao_final.zona_parada, this.logAtual.precisao_odometrica.posicao_final_passos, sabia);
        this.logAtual.marcarInicioFeedback();
        this._salvarLog();
        this.reproduzirMidia(sabia ? 'reforcao_positivo' : 'explicacao_conteudo', sabia ? 'Parabéns!' : 'Deixa eu te explicar...');
        this.addScore(sabia ? 150 : 100);
        this._iniciarEncerramento();
    }

    // 7.3B — 1º erro: para o robô no lugar e aguarda mediador clicar "Segunda Chance"
    // NÃO envia VOLTA_ZERO nem reseta player.x para que o robô fique onde parou.
    // "Segunda Chance" retoma do ponto de parada via FOLLOW_LINE_START.
    _processarResultado(statusTemp) {
        this._mudarEstado(PHASE_STATE.FEEDBACK_ERRO);
        this.movementControl.isMoving = false;
        this.movementControl.pendingResolution = false;
        this.player.vx = 0;
        // Garante tentativaAtual >= 1: registrarInteracao já incrementou,
        // mas _onTimeout não — sem isso ESPERA_INCENTIVO na 2ª daria 3ª chance.
        this.tentativaAtual = Math.max(1, this.tentativaAtual);
        this.logAtual.registrarDicaOferecida();
        this.logAtual.marcarInicioFeedback();
        const [tipo, texto] = FEEDBACK_MIDIA[statusTemp] ?? ['scaffolding', 'Tente novamente!'];
        this.reproduzirMidia(tipo, texto);
        // Para o robô fisicamente onde está — sem homing.
        // O homing só ocorre em "Próxima Questão" (avancarParaProximaQuestao).
        this.bridge.sendCommand('VEL:0 0');
    }

    // 7.4 — 2ª tentativa (acionada pelo botão "Segunda Chance" do mediador)
    _liberarSegundaTentativaComBotao() {
        if (this.state !== PHASE_STATE.FEEDBACK_ERRO) return;
        this.bridge.sendCommand('FOLLOW_LINE_START');
        this._liberarSegundaTentativa();
    }

    _liberarSegundaTentativa() {
        this._mudarEstado(PHASE_STATE.ESPERA_2);
        this._inertiaTimerId = setTimeout(() => this._ativarModoIncentivo(), TIMING.INERTIA_TRIGGER);
    }

    registrarInteracao2(zonaId) {
        if (this.state !== PHASE_STATE.ESPERA_2 && this.state !== PHASE_STATE.ESPERA_INCENTIVO) return;
        this._limparTimers();
        this.showTimerBadge = false;
        this.tentativaAtual++;
        this._mudarEstado(PHASE_STATE.DECISAO_2);

        const zona = this._encontrarZona(zonaId);
        const passoFinal = this._posicaoAtualPassos();
        this.logAtual.registrarRespostaEscolhida(2, zonaId);
        this.logAtual.registrarTentativa(2);

        if (zona?.isCorrect) {
            this.logAtual.finalizarJogada(STATUS_RESPOSTA.ACERTO_ASSISTIDO, zonaId, passoFinal, true);
            this.logAtual.marcarInicioFeedback();
            this._salvarLog();
            this.reproduzirMidia('reforcao_persistencia', 'Muito bem! Com a dica você conseguiu!');
            this.addScore(50);
            this._iniciarEncerramento();
        } else {
            const status = zona ? STATUS_RESPOSTA.ERRO_COGNITIVO : STATUS_RESPOSTA.ERRO_ESPACIAL;
            this.logAtual.finalizarJogada(status, zonaId, passoFinal, false);
            this._processarResultadoFinal(status);
        }
    }

    // 7.4D — Resolução final (robô demonstra)
// 7.4D — Resolução final
    _processarResultadoFinal(statusFinal) {
        this._mudarEstado(PHASE_STATE.FEEDBACK_FINAL);
        this.movementControl.isMoving = false;
        this.bridge.sendCommand('VEL:0 0'); // para o robô fisicamente ao processar 2º erro
        this.ui.updateZones(this.questaoAtual?.alternativas ?? [], this.state, this.questaoAtual?.correta);

        if (this.logAtual.resolucao_final.status_resposta_cod !== statusFinal) {
            this.logAtual.finalizarJogada(
                statusFinal,
                this.logAtual.resolucao_final.zona_parada,
                this.logAtual.precisao_odometrica.posicao_final_passos ?? this._posicaoAtualPassos(),
                false
            );
        }
        this.logAtual.marcarInicioFeedback();
        this._salvarLog();

        const [tipo, texto] = statusFinal === STATUS_RESPOSTA.ERRO_COGNITIVO
            ? ['erro_cognitivo_reincidente', 'Vamos tentar de outro jeito.']
            : ['resolucao', 'Deixa eu te explicar qual era a resposta certa...'];
        this.reproduzirMidia(tipo, texto);
        
        // Após o tempo de feedback, vai para ENCERRAMENTO.
        // Chegando lá, ele vai esperar a criança relaxar para mandar o comando VOLTA_ZERO.
        if (this._finalResultTimerId) clearTimeout(this._finalResultTimerId);
        this._finalResultTimerId = setTimeout(() => {
            this._finalResultTimerId = null;
            this._iniciarEncerramento();
        }, 5_000);
    }

    // 7.5 — Encerramento do ciclo
// 7.5 — Encerramento do ciclo
    _iniciarEncerramento() {
        this._mudarEstado(PHASE_STATE.ENCERRAMENTO);
        this.movementControl.isMoving = false;
        this.bridge.sendCommand('VEL:0 0'); // para o robô caso tenha retomado antes
        this._resultPanel.visible = false;
        this.ui.hideResultModal();
        
        if (this.logAtual) {
            this.logAtual.marcarFimFeedback();
            if (this.logAtual._payloadEnviado && this.logsSession.length > 0) {
                this.logsSession[this.logsSession.length - 1] = this.logAtual.toPayload();
            }
        }
        
        // ❌ REMOVA O AVANÇO AUTOMÁTICO
        // setTimeout(() => this._avancarQuestao(), TIMING.VICTORY_DISPLAY);
        
        // Agora o jogo ficará parado no estado ENCERRAMENTO aguardando a criança relaxar.
    }

    _encerrarFase() {
        const payload = {
            metadados: {
                phaseNumber: this.phaseNumber, totalScore: this.score,
                timestamp: new Date().toISOString(),
                totalQuestoes: this.questoes.length, questoesRespondidas: this.logsSession.length,
            },
            logPedagogico: this.logsSession,
        };
        this.bridge.exportarSessao().catch(() => {});
        this.onPhaseComplete(payload);
    }

    // ──────────────────────────────────────────────────────────
    //  MOVIMENTO E PARADA
    // ──────────────────────────────────────────────────────────

    _atualizarMovimento() {
        if (!ESTADOS_ATIVOS.has(this.state)) return;

        if (Number.isFinite(this.robotInput?.rawX)) {
            this.logAtual?.registrarMovimento(this.movementControl.isMoving, this.robotInput.rawX);
            return; // posição já sincronizada pelo handler de telemetria
        }

        // Modo teclado
        this.logAtual?.registrarMovimento(this.movementControl.isMoving, this._posicaoAtualPassos());
        if (!this.movementControl.isMoving || this.movementControl.pendingResolution) return;
        this.player.vx = this.movementControl.direction * this.movementControl.speed;
        this.player.x  = constrain(this.player.x + this.player.vx, 0, width - this.player.w);
    }

    /** Parada por ESPAÇO (simulação HEG de teclado). */
    _alternarMovimentoComEspaco() {
        if (!ESTADOS_ATIVOS.has(this.state)) return;
        if (this.movementControl.pendingResolution) return;
        this.bridge.sendCommand('VEL:0 0');
        this.movementControl.isMoving = false;
        this.feedbackMessage = 'Concentração detectada — robô parado';
        this.feedbackColor   = [80, 220, 100];
        this._resolverParadaPorProximidade();
    }

    _resolverParadaPorProximidade() {
        const isCompreensao = this.state === PHASE_STATE.COMPREENSAO;
        const zonasAtivas   = isCompreensao ? this.zonasCompreensao : this.zonas;
        if (!zonasAtivas?.length) return;

        const anchorX = this.player.x + this.player.w / 2;
        const metrics = zonasAtivas.map(z => ({
            zona: z,
            distanceX: Math.abs(anchorX - (z.x + z.w / 2)),
            overlaps:  this._dentroTolerancia(anchorX, z),
        })).sort((a, b) => a.distanceX - b.distanceX);

        const maisProxima     = metrics[0];
        const correta         = zonasAtivas.find(z => z.isCorrect) ?? maisProxima?.zona;
        const zonaSelecionada = isCompreensao
            ? maisProxima?.zona ?? null
            : (maisProxima?.overlaps ? maisProxima.zona : null);

        // Exibe o modal HTML
        this.ui.showResultModal(zonaSelecionada?.isCorrect === true, {
            correctLabel:    correta?.label ?? '—',
            selectedLabel:   zonaSelecionada?.label ?? 'Zona neutra',
            selectedDistance: maisProxima.distanceX,
            alternativas:    this.questaoAtual?.alternativas ?? [],
            zones:           this.zonas,
            playerAnchorX:   anchorX,
        });

        this.movementControl.pendingResolution = true;
        if (this._resultPanelTimerId) clearTimeout(this._resultPanelTimerId);

        this._resultPanelTimerId = setTimeout(() => {
            this.movementControl.pendingResolution = false;
            this._resultPanelTimerId = null;

            // Para 2ª tentativa (ESPERA_2 ou ESPERA_INCENTIVO com 1 erro já feito):
            // a telinha fica visível até o mediador clicar em "Próxima Questão".
            // Para compreensão: _iniciarVerificacaoCompreensao já escondeu.
            // Para 1ª tentativa: esconde automaticamente para a pessoa ver as zonas.
            const is2ndAttempt =
                this.state === PHASE_STATE.ESPERA_2 ||
                (this.state === PHASE_STATE.ESPERA_INCENTIVO && this.tentativaAtual >= 1);

            if (!is2ndAttempt) {
                this.ui.hideResultModal();
            }

            if (this.state === PHASE_STATE.COMPREENSAO) {
                this.registrarCompreensao((zonaSelecionada ?? maisProxima.zona).id);

            } else if (this.state === PHASE_STATE.ESPERA_ATIVA) {
                this.registrarInteracao(zonaSelecionada?.id ?? null);

            } else if (this.state === PHASE_STATE.ESPERA_2) {
                this.registrarInteracao2(zonaSelecionada?.id ?? null);

            } else if (this.state === PHASE_STATE.ESPERA_INCENTIVO) {
                if (this.tentativaAtual === 0) {
                    this.registrarInteracao(zonaSelecionada?.id ?? null);
                } else {
                    this.registrarInteracao2(zonaSelecionada?.id ?? null);
                }
            }
        }, TIMING.RESULT_PANEL);
    }

    // ──────────────────────────────────────────────────────────
    //  ZONAS
    // ──────────────────────────────────────────────────────────

    _gerarZonas() {
        if (!this.questaoAtual?.alternativas) return;
        const alts = this.questaoAtual.alternativas;
        const zH   = 68;
        const zW   = Math.min(170, (width - 48) / alts.length - 12);
        const gap  = Math.max(10, (width - 32 - alts.length * zW) / (alts.length + 1));
        const zY   = height - LAYOUT.RODAPE_H - zH - 10;

        this.zonas = alts.map((alt, i) => ({
            id: alt.id, label: alt.label,
            x: gap + i * (zW + gap), y: zY, w: zW, h: zH,
            isCorrect: alt.id === this.questaoAtual.correta,
        }));

        const zonaCorreta = this.zonas.find(z => z.isCorrect);
        if (zonaCorreta && this.logAtual) {
            this.logAtual.registrarAlvoEsperado(Math.round(zonaCorreta.x), Math.round(zonaCorreta.x + zonaCorreta.w));
        }

        this.bridge.updateZones(this.questaoAtual.id, width, height,
            this.zonas.map(z => ({ id: z.id, label: z.label, pixelXMin: z.x, pixelXMax: z.x + z.w, isCorrect: z.isCorrect }))
        );
    }

    _gerarZonasCompreensao() {
        const zW = 180, zH = 80, gap = 60;
        const cX = width / 2, cY = height / 2 + 60;
        this.zonasCompreensao = [
            { id: 'sabia',  label: '💡 Eu sabia!',  x: cX - zW - gap / 2, y: cY, w: zW, h: zH },
            { id: 'chutei', label: '🎲 Eu chutei!', x: cX + gap / 2,      y: cY, w: zW, h: zH },
        ];
    }

    // ──────────────────────────────────────────────────────────
    //  DEMO DA RESPOSTA CORRETA
    // ──────────────────────────────────────────────────────────

    _demonstrarRespostaCorreta() {
        const z = this.zonas.find(z => z.isCorrect);
        if (!z) return;

        const stepAlvo = this.bridge.pixelXToSteps(z.x + z.w / 2, width, this.player.w);
        console.log(`[Demo] Zona="${z.label}" stepAlvo=${stepAlvo}`);

        this._demoAtivo    = true;
        this._demoStepAlvo = stepAlvo;
        this.bridge.sendCommand('FOLLOW_LINE_START');

        if (this._demoTimeoutId) clearTimeout(this._demoTimeoutId);
        this._demoTimeoutId = setTimeout(() => {
            if (!this._demoAtivo) return;
            this._demoAtivo = false;
            this.bridge.sendCommand('VEL:0');
            console.log('[Demo] Timeout — carrinho parado por segurança.');
        }, TIMING.DEMO_TIMEOUT);
    }

    // ──────────────────────────────────────────────────────────
    //  CANVAS — cenário e player fallback
    // ──────────────────────────────────────────────────────────

    _drawCenario() {
        const bg = this._getThemeColor('--cor-fundo-hud');
        background(bg[0], bg[1], bg[2]);
        const laneY = this._getPlayerLaneY() + this.player.h * 0.48;
        const lane = this._getThemeColor('--cor-texto-icone');
        push();
        noStroke();
        fill(lane[0], lane[1], lane[2], 12);  rect(20, laneY - 10, width - 40, 50, 36);
        fill(lane[0], lane[1], lane[2], 8);   rect(44, laneY + 5,  width - 88, 21, 999);
        pop();
    }

    _drawPlayer() {
        const { x: px, w: pw, h: ph } = this.player;
        const py = this._getPlayerLaneY();

        if (this.playerSprite) { image(this.playerSprite, px, py, pw, ph); return; }

        // Fallback desenhado por código com cores do tema
        const moving = this.movementControl.isMoving;
        const texto = this._getThemeColor('--cor-texto-icone');
        const botao = this._getThemeColor('--cor-botao-idle');
        push();
        rectMode(CORNER);
        noStroke(); fill(texto[0], texto[1], texto[2], 30); rect(px + 4, py + ph * 0.75 + 6, pw, ph * 0.28, 8);
        stroke(texto[0], texto[1], texto[2], 30); strokeWeight(1.5);
        fill(moving ? color(botao[0], botao[1], botao[2]) : color(texto[0], texto[1], texto[2]));
        rect(px, py + ph * 0.25, pw, ph * 0.5, 10);
        noStroke(); fill(texto[0], texto[1], texto[2], 12); rect(px + 4, py + ph * 0.27, pw - 8, ph * 0.15, 6);
        fill(texto[0], texto[1], texto[2], 160);
        const r = pw * 0.18, rY = py + ph * 0.72;
        ellipse(px + pw * 0.22, rY, r, r); ellipse(px + pw * 0.78, rY, r, r);
        fill(texto[0], texto[1], texto[2], 80);
        ellipse(px + pw * 0.22, rY, r * 0.5, r * 0.5); ellipse(px + pw * 0.78, rY, r * 0.5, r * 0.5);
        fill(moving ? color(botao[0], botao[1], botao[2], 180) : color(texto[0], texto[1], texto[2], 220));
        ellipse(px + pw / 2, py + ph * 0.18, pw * 0.22, pw * 0.22);
        fill(texto[0], texto[1], texto[2], moving ? 80 : 200);
        ellipse(px + pw / 2, py + ph * 0.14, pw * 0.08, pw * 0.08);
        pop();
    }

    // ──────────────────────────────────────────────────────────
    //  UI — atualização a cada frame
    // ──────────────────────────────────────────────────────────

    _atualizarUI() {
        this.ui.update({
            score:         this.score,
            lives:         this.lives,
            questaoIndex:  this.questaoAtualIndex,
            totalQuestoes: this.questoes.length,
            state:         this.state,
            timerIncentivo: this.timerIncentivo,
            showTimer:     this.showTimerBadge,
        });
    }

    // ──────────────────────────────────────────────────────────
    //  MÍDIA (overridable pelas subclasses)
    // ──────────────────────────────────────────────────────────

    /**
     * @override Narra o enunciado via audio pre-gravado.
     * @param {import('./GameBridge.js').Questao} questao
     */
    reproduzirAudioQuestao(questao) {
        console.log(`[Mídia] Enunciado: "${questao?.enunciado}"`);
        AudioNarrator.playEnunciado(questao?.id);
    }

    /**
     * @override Reproduz feedback audio + animacao do robo.
     * @param {string} tipo
     * @param {string} textoFallback
     */
    reproduzirMidia(tipo, textoFallback) {
        console.log(`[Mídia] tipo="${tipo}" | texto="${textoFallback}"`);
        // Mensagem textual removida da UI (speech bubble retirada)
        // Mantida internamente para logs / debug
        this.feedbackMessage = textoFallback;
        this.feedbackColor   = this.robot.colorForTipo(tipo);
        this.robot.playByTipo(tipo);
        AudioNarrator.playFeedback(tipo);
    }

    // ──────────────────────────────────────────────────────────
    //  HELPERS
    // ──────────────────────────────────────────────────────────

    _instalarControlesGlobais() {
        this._globalKeydownHandler = (e) => {
            const tag = e?.target?.tagName?.toLowerCase?.() ?? '';
            if (tag === 'input' || tag === 'textarea') return;
            if (e.code === 'Space')      { e.preventDefault(); this._alternarMovimentoComEspaco(); }
            if (e.code === 'ArrowLeft')  { e.preventDefault(); this.movementControl.direction = -1; }
            if (e.code === 'ArrowRight') { e.preventDefault(); this.movementControl.direction =  1; }
        };
        document.addEventListener('keydown', this._globalKeydownHandler, { passive: false });
    }

    _selecionarPalavraAtual() {
        const banco = this.questaoAtual?.bancoPalavras ?? this.questaoAtual?.palavras ?? [];
        const fixa  = this.questaoAtual?.palavra;
        if (banco.length > 0) { this.currentWord = String(selectRandomElement(banco) ?? '').trim().toUpperCase(); }
        else if (typeof fixa === 'string') { this.currentWord = fixa.trim().toUpperCase(); }
        else { this.currentWord = ''; }
    }

    _atualizarLayoutPalavra() {
        // generateLinearWordLayout aceita apenas (word, canvasWidth, canvasHeight)
        this.wordLayout = generateLinearWordLayout(this.currentWord, width, height);
    }

    _salvarLog() {
        if (!this.logAtual || this.logAtual._payloadEnviado) return;
        const payload = this.logAtual.toPayload();
        this.logsSession.push(payload);
        this.logAtual._payloadEnviado = true;
        this.bridge.registrarJogada(payload);
    }

    _resetarPosicaoRobo() {
        this.player.x = 50;
        this.player.y = this._getPlayerLaneY();
        this.player.vx = 0;
        this.movementControl.isMoving = false;
        this.movementControl.pendingResolution = false;
    }

    _resetarWatchdogs() { this._limparTimers(); this.showTimerBadge = false; this.timerIncentivo = 0; }

    _limparTimers() {
        if (this._inertiaTimerId)     { clearTimeout(this._inertiaTimerId);     this._inertiaTimerId     = null; }
        if (this._timeoutTimerId)     { clearTimeout(this._timeoutTimerId);     this._timeoutTimerId     = null; }
        if (this._timerInterval)      { clearInterval(this._timerInterval);     this._timerInterval      = null; }
        if (this._finalResultTimerId) { clearTimeout(this._finalResultTimerId); this._finalResultTimerId = null; }
    }

    _encontrarZona(id)        { return this.zonas.find(z => z.id === id) ?? null; }
    _posicaoAtualPassos()     { return Number.isFinite(this.robotInput?.rawX) ? this.robotInput.rawX : Math.round(this.player.x); }
    _getPlayerLaneY()         { return height * 0.55; }

    _dentroTolerancia(anchorX, zona) {
        const tol = Math.max(16, Math.min(36, zona.w * 0.2));
        return anchorX >= zona.x - tol && anchorX <= zona.x + zona.w + tol;
    }

    _determinarZonaAtual() {
        const zonasAtivas = this.state === PHASE_STATE.COMPREENSAO
            ? this.zonasCompreensao
            : this.zonas;
        if (!zonasAtivas?.length) return 'neutro';
        const anchorX = this.player.x + this.player.w / 2;
        let closest = null, minDist = Infinity;
        for (const z of zonasAtivas) {
            const dist = Math.abs(anchorX - (z.x + z.w / 2));
            if (dist < minDist) { minDist = dist; closest = z; }
        }
        return closest?.id ?? 'neutro';
    }

    _getSpriteZone() {
        const spriteW = Math.min(LAYOUT.SPRITE_W_MAX, width * LAYOUT.SPRITE_W_FRAC);
        const zonaTopoY = LAYOUT.HUD_H + 4;
        const dispH = height - LAYOUT.RODAPE_H - zonaTopoY;
        const h = Math.min(spriteW * 1.15, dispH - 8);
        const w = h / 1.15;
        return { x: width - w - LAYOUT.SPRITE_GAP, y: zonaTopoY + (dispH - h) / 2, w, h };
    }

    _getThemeColor(varName) {
        const val = getComputedStyle(document.documentElement)
            .getPropertyValue(varName).trim();
        const hex = val.replace('#', '');
        return [
            parseInt(hex.slice(0,2), 16),
            parseInt(hex.slice(2,4), 16),
            parseInt(hex.slice(4,6), 16),
        ];
    }

    _getLayoutConstraints() {
        return { topY: LAYOUT.HUD_H + 8, botY: height - LAYOUT.RODAPE_H - 8 };
    }

    // ──────────────────────────────────────────────────────────
    //  RECALIBRAÇÃO HEG EM JOGO
    // ──────────────────────────────────────────────────────────

    _iniciarRecalibracao() {
        // Só recalibra durante estados onde o robô pode estar em movimento.
        // Estados de espera pós-questão (ENCERRAMENTO, AGUARDANDO_PROXIMA, etc.)
        // já têm o robô parado — não precisa interromper.
        const estadosInterrompíveis = new Set([
            PHASE_STATE.ESPERA_ATIVA, PHASE_STATE.ESPERA_INCENTIVO,
            PHASE_STATE.ESPERA_2, PHASE_STATE.COMPREENSAO,
            PHASE_STATE.AGUARDANDO_COMPREENSAO, PHASE_STATE.FEEDBACK_ERRO,
        ]);
        if (!estadosInterrompíveis.has(this.state)) return;

        this._estadoAntesDaRecalibracao = this.state;
        this._limparTimers();
        this.movementControl.isMoving = false;
        this.bridge.sendCommand('VOLTA_ZERO');
        this._mudarEstado(PHASE_STATE.RECALIBRANDO);
        console.log(`[Recal] Recalibração iniciada. Estado salvo: ${this._estadoAntesDaRecalibracao}`);
    }

    _retomadaAposRecalibracao() {
        if (this.state !== PHASE_STATE.RECALIBRANDO) return;

        const estadoAntes = this._estadoAntesDaRecalibracao ?? PHASE_STATE.ESPERA_ATIVA;
        this._estadoAntesDaRecalibracao = null;
        console.log(`[Recal] Retomando após calibração. Estado restaurado: ${estadoAntes}`);

        // Estados de "aguardando mediador" — restaura sem iniciar o robô
        // (o botão correspondente já cuida do FOLLOW_LINE_START)
        if (estadoAntes === PHASE_STATE.AGUARDANDO_COMPREENSAO || estadoAntes === PHASE_STATE.FEEDBACK_ERRO) {
            this._mudarEstado(estadoAntes);
            return;
        }

        // Compreensão ativa → inicia robô e volta ao estado de compreensão
        if (estadoAntes === PHASE_STATE.COMPREENSAO) {
            this.bridge.sendCommand('FOLLOW_LINE_START');
            this._mudarEstado(PHASE_STATE.COMPREENSAO);
            this.ui.updateZones([], PHASE_STATE.COMPREENSAO, null);
            return;
        }

        // Estados ativos (ESPERA_ATIVA, ESPERA_2, ESPERA_INCENTIVO) →
        // reinicia o robô e restaura com base em tentativaAtual
        this.bridge.sendCommand('FOLLOW_LINE_START');
        if (this.tentativaAtual >= 1) {
            this._mudarEstado(PHASE_STATE.ESPERA_2);
        } else {
            this._mudarEstado(PHASE_STATE.ESPERA_ATIVA);
        }
        this._inertiaTimerId = setTimeout(() => this._ativarModoIncentivo(), TIMING.INERTIA_TRIGGER);
    }

    // ──────────────────────────────────────────────────────────
    //  CONTROLES PÚBLICOS
    // ──────────────────────────────────────────────────────────

    checkGameState() { if (this.lives <= 0) this.onGameOver(); }
    addScore(pts)    { this.score += pts; }
    loseLife()       { this.lives = Math.max(0, this.lives - 1); }
    pause()          { this.isPaused = true;  this._limparTimers(); }
    resume()         { this.isPaused = false; }

    onPhaseComplete(payload) { console.log('[GamePhase] Fase completa!', payload); }
    onGameOver()             { console.log('[GamePhase] Game Over!'); this.pause(); }

    handleKeyPressed() {
        if (keyCode === 27) this.isPaused ? this.resume() : this.pause();
    }

    handleResize() {
        this._atualizarLayoutPalavra();
        this._gerarZonas();
        this._gerarZonasCompreensao();
        this.player.y = constrain(this.player.y, 0, height - this.player.h);
    }

    // Atalhos para subclasses
    get STATUS()  { return STATUS_RESPOSTA; }
    get ESTADOS() { return PHASE_STATE; }
    avancarParaProximaQuestao() {
        // Esconde a telinha de resultado imediatamente ao clicar no botão
        this._resultPanel.visible = false;
        this.ui.hideResultModal();
        this.movementControl.pendingResolution = false;

        // Guard: evita dupla execução (sketch.js + GameBridge emitem o mesmo evento)
        if (this._avancoEmAndamento) return;

        if (this.state === PHASE_STATE.AGUARDANDO_PROXIMA || this.state === PHASE_STATE.ENCERRAMENTO) {
            this._avancoEmAndamento = true;
            // CORREÇÃO: sempre envia VOLTA_ZERO para resetar posição antes da próxima questão.
            // Aguarda ~3 s para o homing físico completar antes de retomar o vaivém.
            this.bridge.sendCommand('VOLTA_ZERO');
            console.log('[GamePhase] Próxima questão — enviando VOLTA_ZERO, aguardando homing...');

            setTimeout(() => {
                this._avancoEmAndamento = false;
                if (this.state === PHASE_STATE.AGUARDANDO_PROXIMA || this.state === PHASE_STATE.ENCERRAMENTO) {
                    this.bridge.sendCommand('FOLLOW_LINE_START');
                    this._avancarQuestao();
                }
            }, 3_000);
        }
    }
}
