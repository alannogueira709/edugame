// GameBridge.js
// ============================================================
//  GameBridge — Biblioteca de comunicação do NeuroBeep
//
//  Encapsula toda a comunicação com:
//    • Tauri (eventos e invocações ao backend Rust)
//    • Hardware físico (carrinho ESP32 via BLE / bluetooth.rs)
//    • Dashboard React (sincronização de estado e frames)
//    • Gêmeo Digital (calibração de trilho e zonas)
//
//  COMO USAR em GamePhase ou qualquer outra cena:
//
//    import { GameBridge } from './GameBridge.js';
//
//    const bridge = new GameBridge();
//    await bridge.init();                      // carrega config do trilho
//    bridge.onTelemetry(handler);              // escuta pacotes BLE
//    bridge.sendCommand('FOLLOW_LINE_START');  // manda ordem ao carrinho
//    bridge.syncQuestion({ ... });             // avisa o dashboard
//    bridge.dispose();                         // limpa todos os listeners
//
// ============================================================

// ── Configurações padrão do serviço BLE ─────────────────────
export const DEFAULT_BT_CONFIG = {
    serviceUUID:        '4fafc201-1fb5-459e-8fcc-c5c9c331914b',
    characteristicUUID: 'beb5483e-36e1-4688-b7f5-ea07361b26a8',
    deviceNamePrefix:   'ESP32',
};

// ── Nomes canônicos dos eventos Tauri ───────────────────────
export const TAURI_EVENTS = {
    // Recebe do backend (listen)
    TELEMETRY_DATA:    'telemetry-data',
    TWIN_HEG_STOP:     'twin_heg_stop',
    TWIN_HEG_RESUME:   'twin_heg_resume',
    TWIN_TELEMETRY:    'twin_telemetry',
    NEUROBEEP_CMD:     'neurobeep_cmd',

    // Envia ao backend / dashboard (emit)
    NEUROBEEP_SYNC:    'neurobeep_sync',
    NEUROBEEP_FRAME:   'neurobeep_frame',
    TWIN_ZONES_UPDATE: 'twin_zones_update',
};

// ── Nomes canônicos dos comandos Rust (invoke) ───────────────
export const RUST_COMMANDS = {
    LOAD_TWIN_CONFIG:       'load_twin_config',
    REGISTRAR_JOGADA:       'registrar_jogada',
    EXPORTAR_SESSAO:        'exportar_sessao',
    SEND_COMMAND:           'send_command',
    PROCESS_TWIN_TELEMETRY: 'process_twin_telemetry',
};

// ============================================================
//  Classe principal
// ============================================================
export class GameBridge {

    /**
     * @param {object}  [options]
     * @param {boolean} [options.enableBleDebugHud=false] Mostra HUD de diagnóstico BLE na tela
     * @param {number}  [options.frameSampleRate=4]       A cada quantos frames enviar miniatura
     */
    constructor(options = {}) {
        this._enableBleDebugHud = options.enableBleDebugHud ?? false;
        this._frameSampleRate   = options.frameSampleRate ?? 4;

        /** Config do trilho carregada do Rust via load_twin_config @type {object|null} */
        this.twinConfig = null;

        /** Handlers registrados externamente */
        this._telemetryHandlers = [];
        this._hegStopHandlers   = [];
        this._hegResumeHandlers = [];
        this._commandHandlers   = [];

        /** Referências de unlisten para cleanup */
        this._unlistens = [];

        /** BLE debug HUD element */
        this._bleDebugEl     = null;
        this._blePacketCount = 0;
        this._lastDebugLog   = 0;

        /** Frame counter para throttle da miniatura */
        this._frameCounter  = 0;
        this._canvasRef     = null;
        this._capturePending = false; // evita empilhar chamadas ao Rust
    }

    // ──────────────────────────────────────────────────────────
    //  INICIALIZAÇÃO
    // ──────────────────────────────────────────────────────────

    /**
     * Registra todos os listeners Tauri e pré-carrega a config do trilho.
     * Deve ser chamado no setup() da cena que usar o bridge.
     * @returns {Promise<void>}
     */
    async init() {
        await this._loadTwinConfig();
        await this._registerListeners();
        console.log('[GameBridge] Inicializado.');
    }

    // ──────────────────────────────────────────────────────────
    //  API — Ouvir eventos de hardware
    // ──────────────────────────────────────────────────────────

    /**
     * Registra um handler para pacotes de telemetria BLE.
     * O handler recebe um objeto { steps, velMedia, odomX, rawBytes }.
     *
     * @param {(data: TelemetryData) => void} handler
     * @returns {() => void} Função para remover o handler
     */
    onTelemetry(handler) {
        this._telemetryHandlers.push(handler);
        return () => {
            this._telemetryHandlers = this._telemetryHandlers.filter(h => h !== handler);
        };
    }

    /**
     * Registra um handler para o evento twin_heg_stop.
     * Disparado quando o HEG detecta concentração → parar carrinho.
     *
     * @param {() => void} handler
     * @returns {() => void} Função para remover o handler
     */
    onHegStop(handler) {
        this._hegStopHandlers.push(handler);
        return () => {
            this._hegStopHandlers = this._hegStopHandlers.filter(h => h !== handler);
        };
    }

    /**
     * Registra um handler para o evento twin_heg_resume.
     * Disparado quando o HEG detecta relaxamento → retomar movimento.
     *
     * @param {() => void} handler
     * @returns {() => void} Função para remover o handler
     */
    onHegResume(handler) {
        this._hegResumeHandlers.push(handler);
        return () => {
            this._hegResumeHandlers = this._hegResumeHandlers.filter(h => h !== handler);
        };
    }

    /**
     * Registra um handler para comandos recebidos do Dashboard React.
     * O handler recebe o nome do comando como string (ex: 'PROXIMA_QUESTAO').
     * Internamente escuta o evento Tauri 'neurobeep_cmd' emitido pelo mediador.
     *
     * @param {(command: string) => void} handler
     * @returns {() => void} Função para remover o handler
     */
    onCommand(handler) {
        this._commandHandlers.push(handler);
        return () => {
            this._commandHandlers = this._commandHandlers.filter(h => h !== handler);
        };
    }

    // ──────────────────────────────────────────────────────────
    //  API — Controle do carrinho físico
    // ──────────────────────────────────────────────────────────

    /**
     * Envia um comando direto ao backend Rust.
     * Exemplos: 'VEL:0 0', 'FOLLOW_LINE_START', 'VEL:200 200'
     *
     * @param {string} command
     */
    sendCommand(command) {
        this._invoke(RUST_COMMANDS.SEND_COMMAND, { command })
            .catch(e => console.warn('[GameBridge] sendCommand falhou:', e));
    }

    /**
     * Converte passos reais (odom_theta) → posição X em pixels no canvas.
     * Usa a twinConfig carregada no init().
     *
     * @param {number} steps       - Valor de odom_theta / getRelativeSteps()
     * @param {number} canvasWidth - Largura atual do canvas p5.js
     * @param {number} playerWidth - Largura do sprite do player
     * @returns {number} Posição X em pixels (constrained ao canvas)
     */
    stepsToPixelX(steps, canvasWidth, playerWidth) {
        const cfg    = this.twinConfig ?? {};
        const total  = cfg.total_track_steps  ?? 3125;
        const left   = cfg.left_margin_steps  ?? 0;
        const right  = cfg.right_margin_steps ?? 0;
        const usable = Math.max(1, total - left - right);
        const pct    = Math.max(0, Math.min(1, Math.abs(steps - left) / usable));
        return Math.max(0, Math.min(pct * (canvasWidth - playerWidth), canvasWidth - playerWidth));
    }

    /**
     * Converte posição X em pixels → passos no trilho físico.
     * Fórmula inversa de stepsToPixelX — usada para calcular step alvo da zona.
     *
     * @param {number} pixelX      - Posição X em pixels (ex: centro da zona)
     * @param {number} canvasWidth
     * @param {number} playerWidth
     * @returns {number}
     */
    pixelXToSteps(pixelX, canvasWidth, playerWidth) {
        const cfg    = this.twinConfig ?? {};
        const total  = cfg.total_track_steps  ?? 3125;
        const left   = cfg.left_margin_steps  ?? 0;
        const right  = cfg.right_margin_steps ?? 0;
        const usable = Math.max(1, total - left - right);
        const pct    = Math.max(0, Math.min(1, pixelX / Math.max(1, canvasWidth - playerWidth)));
        return Math.round(left + pct * usable);
    }

    // ──────────────────────────────────────────────────────────
    //  API — Sincronização com o Dashboard
    // ──────────────────────────────────────────────────────────

    /**
     * Sincroniza a posição atual do player com o Dashboard React.
     * @param {{ x: number, normalizedX: number, robotPosition: string }} data
     */
    syncPosition(data) {
        this._emit(TAURI_EVENTS.NEUROBEEP_SYNC, {
            source: 'GAME',
            type:   'SYNC_POSITION',
            payload: data,
        });
    }

    /**
     * Sincroniza a questão atual com o Dashboard React.
     * @param {{ tituloQuestao: string, opcoes: Alternativa[], questionIndex: number }} data
     */
    syncQuestion(data) {
        this._emit(TAURI_EVENTS.NEUROBEEP_SYNC, {
            source: 'GAME',
            type:   'SYNC_QUESTION',
            payload: data,
        });
    }

    /**
     * Sincroniza o estado da máquina de estados com o Dashboard.
     * @param {{ sessionState: string, activeTimer: number }} data
     */
    syncState(data) {
        this._emit(TAURI_EVENTS.NEUROBEEP_SYNC, {
            source: 'GAME',
            type:   'SYNC_STATE',
            payload: data,
        });
    }

    /**
     * Publica o mapeamento de zonas pixel→step para o Gêmeo Digital.
     * O DigitalTwinPanel converte pixelXMin/Max → stepMin/Max via calibração.
     *
     * @param {string} questaoId
     * @param {number} canvasWidth
     * @param {number} canvasHeight
     * @param {Array<{ id: string, label: string, pixelXMin: number, pixelXMax: number, isCorrect: boolean }>} zonas
     */
    updateZones(questaoId, canvasWidth, canvasHeight, zonas) {
        const payload = { questaoId, screenWidth: canvasWidth, screenHeight: canvasHeight, zonas };
        this._emit(TAURI_EVENTS.TWIN_ZONES_UPDATE, payload);
        console.log(
            '[GameBridge] twin_zones_update →',
            zonas.map(z => `${z.label}:[${Math.round(z.pixelXMin)}–${Math.round(z.pixelXMax)}]`).join(' | ')
        );
    }

    // ──────────────────────────────────────────────────────────
    //  API — Dados pedagógicos
    // ──────────────────────────────────────────────────────────

    /**
     * Persiste uma jogada no backend Rust.
     * @param {object} payload - Resultado de QuestionLog.toPayload()
     */
    registrarJogada(payload) {
        this._invoke(RUST_COMMANDS.REGISTRAR_JOGADA, { payload })
            .then(msg => console.log('[GameBridge] Rust confirmou jogada:', msg))
            .catch(err => console.error('[GameBridge] Erro ao registrar jogada:', err));
    }

    /**
     * Solicita ao Rust que exporte a sessão atual como JSON.
     * @returns {Promise<string>} Caminho do arquivo exportado
     */
    exportarSessao() {
        return this._invoke(RUST_COMMANDS.EXPORTAR_SESSAO)
            .then(caminho => {
                console.log('[GameBridge] JSON salvo em:', caminho);
                return caminho;
            })
            .catch(err => {
                console.error('[GameBridge] Erro ao exportar sessão:', err);
                throw err;
            });
    }

    // ──────────────────────────────────────────────────────────
    //  API — Miniatura do frame (Dashboard thumbnail)
    // ──────────────────────────────────────────────────────────

    /**
     * Deve ser chamado no draw() da cena.
     *
     * A cada `frameSampleRate` chamadas, delega ao Rust para tirar um
     * screenshot da `janela_projetor` inteira — capturando tanto o canvas
     * p5.js quanto os elementos HTML do GameUI (HUD, zonas, challenge card).
     *
     * Se o Tauri não estiver disponível (dev sem app), faz fallback para
     * canvas.toDataURL() que captura só o canvas (comportamento anterior).
     */
    sendFrameTick() {
        this._frameCounter += 1;

        // Throttle: captura a cada N frames. O comando Rust é assíncrono,
        // então usamos _capturePending para não empilhar chamadas.
        if (this._frameCounter % this._frameSampleRate !== 0) return;
        if (this._capturePending) return;

        // ── Caminho 1: Rust capture_image (canvas + HTML overlay) ──
        if (window.__TAURI__?.core?.invoke) {
            this._capturePending = true;
            window.__TAURI__.core
                .invoke('capturar_frame_jogo')
                .catch(err => console.warn('[GameBridge] capturar_frame_jogo falhou:', err))
                .finally(() => { this._capturePending = false; });
            return;
        }

        // ── Caminho 2: fallback sem Tauri (só canvas p5.js) ──────────
        try {
            if (!this._canvasRef) this._canvasRef = document.querySelector('canvas');
            if (!this._canvasRef) return;
            const frame = this._canvasRef.toDataURL('image/jpeg', 0.5);
            this._emit(TAURI_EVENTS.NEUROBEEP_FRAME, { frame });
        } catch (err) {
            console.warn('[GameBridge] sendFrameTick fallback erro:', err);
        }
    }

    // ──────────────────────────────────────────────────────────
    //  API — BLE Debug HUD
    // ──────────────────────────────────────────────────────────

    /**
     * Cria (ou mostra) o HUD de diagnóstico BLE no canto inferior direito.
     * Só tem efeito se enableBleDebugHud=true no construtor.
     */
    showBleDebugHud() {
        if (!this._enableBleDebugHud || this._bleDebugEl) return;

        const el = document.createElement('div');
        el.id = 'ble-debug-hud';
        el.style.cssText = `
            position: fixed; bottom: 60px; right: 12px; z-index: 9999;
            background: rgba(0,0,0,0.75); color: #4ade80; font-family: monospace;
            font-size: 10px; padding: 6px 10px; border-radius: 8px;
            border: 1px solid rgba(74,222,128,0.3); pointer-events: none;
            line-height: 1.6;
        `;
        el.innerHTML = `
            <div style="color:#7dd3fc;font-weight:bold">BLE ✓ conectado</div>
            <div id="ble-hud-packets">pacotes: 0</div>
            <div id="ble-hud-steps">steps: —</div>
            <div id="ble-hud-meters">metros: —</div>
            <div id="ble-hud-vel">vel: —</div>
            <div id="ble-hud-pos">player.x: —</div>
        `;
        document.body.appendChild(el);
        this._bleDebugEl = el;
    }

    /**
     * Atualiza os valores exibidos no HUD de diagnóstico BLE.
     * @param {{ odomX: number, steps: number, vel: number, playerX: number }} data
     */
    updateBleDebugHud({ odomX, steps, vel, playerX }) {
        if (!this._bleDebugEl) return;
        const el = id => document.getElementById(id);
        if (el('ble-hud-packets')) el('ble-hud-packets').textContent = `pacotes: ${this._blePacketCount}`;
        if (el('ble-hud-steps'))   el('ble-hud-steps').textContent   = `steps: ${Number(steps).toFixed(2)}`;
        if (el('ble-hud-meters'))  el('ble-hud-meters').textContent  = `metros: ${Number(odomX).toFixed(4)}`;
        if (el('ble-hud-vel'))     el('ble-hud-vel').textContent     = `vel: ${Number(vel).toFixed(3)} m/s`;
        if (el('ble-hud-pos'))     el('ble-hud-pos').textContent     = `player.x: ${Math.round(playerX)}`;
    }

    // ──────────────────────────────────────────────────────────
    //  LIMPEZA
    // ──────────────────────────────────────────────────────────

    /**
     * Remove todos os listeners Tauri e destrói o HUD de diagnóstico.
     * Deve ser chamado no cleanup() da cena.
     */
    dispose() {
        for (const unlisten of this._unlistens) {
            try { unlisten(); } catch (_) {}
        }
        this._unlistens = [];
        this._telemetryHandlers = [];
        this._hegStopHandlers   = [];
        this._hegResumeHandlers = [];
        this._commandHandlers   = [];

        if (this._bleDebugEl?.parentNode) {
            this._bleDebugEl.parentNode.removeChild(this._bleDebugEl);
            this._bleDebugEl = null;
        }

        console.log('[GameBridge] Recursos liberados.');
    }

    // ──────────────────────────────────────────────────────────
    //  INTERNOS
    // ──────────────────────────────────────────────────────────

    async _registerListeners() {
        if (!window.__TAURI__?.event?.listen) {
            console.warn('[GameBridge] Tauri não disponível — listeners BLE não registrados.');
            return;
        }

        // ── telemetry-data: pacote BLE base64 emitido pelo bluetooth.rs ──
        const unlistenTelemetry = await window.__TAURI__.event.listen(
            TAURI_EVENTS.TELEMETRY_DATA,
            (event) => this._onTauriTelemetry(event)
        );

        // ── twin_heg_stop: HEG detectou concentração → parar ──
        const unlistenStop = await window.__TAURI__.event.listen(
            TAURI_EVENTS.TWIN_HEG_STOP,
            () => this._hegStopHandlers.forEach(h => h())
        );

        // ── twin_heg_resume: HEG baixou → retomar ──
        const unlistenResume = await window.__TAURI__.event.listen(
            TAURI_EVENTS.TWIN_HEG_RESUME,
            () => this._hegResumeHandlers.forEach(h => h())
        );

        // ── twin_calibration_update: Rust recalibrou o limite do trilho ──
        // Mantém twinConfig sincronizado mesmo que _onTauriTelemetry ainda não
        // tenha recebido um pacote (ex: conexão tardia).
        const unlistenCalib = await window.__TAURI__.event.listen(
            'twin_calibration_update',
            (event) => {
                const p = event.payload;
                if (!this.twinConfig) this.twinConfig = {};
                if (p.totalTrackSteps  > 0) this.twinConfig.total_track_steps  = p.totalTrackSteps;
                if (p.leftMarginSteps  !== undefined) this.twinConfig.left_margin_steps  = p.leftMarginSteps;
                if (p.rightMarginSteps !== undefined) this.twinConfig.right_margin_steps = p.rightMarginSteps;
                console.log('[GameBridge] twin_calibration_update →', this.twinConfig);
            }
        );

        // ── neurobeep_cmd: comandos do Dashboard React para a cena ──────────
        // Roteia comandos como 'PROXIMA_QUESTAO' para os handlers registrados
        // com onCommand(). Permite que GamePhase reaja sem depender do sketch.js.
        const unlistenCmd = await window.__TAURI__.event.listen(
            TAURI_EVENTS.NEUROBEEP_CMD,
            (event) => {
                const cmdType = event.payload?.type || event.payload?.command;
                if (cmdType) {
                    this._commandHandlers.forEach(h => h(cmdType));
                }
            }
        );

        this._unlistens.push(unlistenTelemetry, unlistenStop, unlistenResume, unlistenCalib, unlistenCmd);
    }

    async _loadTwinConfig() {
        if (!window.__TAURI__?.core?.invoke) return;
        try {
            this.twinConfig = await window.__TAURI__.core.invoke(RUST_COMMANDS.LOAD_TWIN_CONFIG);
            console.log('[GameBridge] TwinConfig carregado:', this.twinConfig);
        } catch (e) {
            console.warn('[GameBridge] load_twin_config falhou (usando defaults):', e);
        }
    }

    /**
     * Decodifica o pacote base64, extrai os campos relevantes e
     * repassa para todos os handlers registrados com onTelemetry().
     * Também atualiza twinConfig.total_track_steps a partir do campo
     * encoder_left_count (= getLimitePassos()) enviado pelo ESP32 em
     * todo pacote — garante que stepsToPixelX sempre usa o limite real.
     * @private
     */
    _onTauriTelemetry(event) {
        try {
            const b64   = event.payload;
            const bin   = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

            if (bytes.length < 119) return;

            const dv      = new DataView(bytes.buffer);

            // encoder_left_count (offset 2, int32 LE) = getLimitePassos()
            // Atualiza o limite real do trilho a cada pacote — calibração contínua
            const limitPassos = dv.getInt32(2, true);
            if (limitPassos > 0) {
                if (!this.twinConfig) this.twinConfig = {};
                if (this.twinConfig.total_track_steps !== limitPassos) {
                    console.log(
                        `[GameBridge] Trilho recalibrado: ${this.twinConfig.total_track_steps ?? '?'} → ${limitPassos} passos`
                    );
                    this.twinConfig.total_track_steps = limitPassos;
                }
            }

            // odom_x (offset 42) = getSteps() — passos desde o homing.
            // Mesma unidade que getLimitePassos() → uso direto em stepsToPixelX.
            // odom_theta (offset 50) = getRelativePosition() em MM — não em passos!
            const steps    = dv.getFloat32(42, true); // getSteps() — PASSOS
            const relMm    = dv.getFloat32(50, true); // getRelativePosition() — mm (debug)
            const velEsq   = dv.getFloat32(10, true);
            const velDir   = dv.getFloat32(14, true);
            const velMedia = (velEsq + velDir) / 2;
            const odomX    = dv.getFloat32(46, true); // getAbsolutePosition() — mm absoluto (debug)

            this._blePacketCount++;

            /** @type {TelemetryData} */
            const data = { steps, velMedia, odomX, rawBytes: bytes };

            for (const handler of this._telemetryHandlers) {
                handler(data);
            }

            // Debug 1x/s
            const agora = Date.now();
            if (agora - this._lastDebugLog > 1_000) {
                this._lastDebugLog = agora;
                console.log(
                    `[BLE #${this._blePacketCount}] steps=${steps.toFixed(1)} ` +
                    `vel=${velMedia.toFixed(3)} limit=${limitPassos}`
                );
            }
        } catch (err) {
            console.warn('[GameBridge] _onTauriTelemetry erro:', err);
        }
    }

    /** Emite um evento Tauri (sem-op se Tauri não disponível). */
    async _emit(eventName, payload) {
        try {
            if (window.__TAURI__?.event?.emit) {
                await window.__TAURI__.event.emit(eventName, payload);
            }
        } catch (e) {
            console.debug('[GameBridge] emit falhou:', eventName, e);
        }
    }

    /** Invoca um comando Rust (sem-op se Tauri não disponível). */
    async _invoke(command, args = {}) {
        if (!window.__TAURI__?.core?.invoke) return undefined;
        return window.__TAURI__.core.invoke(command, args);
    }
}

// ──────────────────────────────────────────────────────────
//  JSDoc — tipos exportados para autocomplete e documentação
// ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} TelemetryData
 * @property {number}     steps    - Passos acumulados (odom_theta / getRelativeSteps)
 * @property {number}     velMedia - Velocidade média dos dois motores em m/s
 * @property {number}     odomX    - Posição em metros (debug)
 * @property {Uint8Array} rawBytes - Pacote BLE bruto completo (115+ bytes)
 */

/**
 * @typedef {Object} Questao
 * Representa uma questão completa do roteiro pedagógico.
 *
 * @property {string}        id           - Identificador único (ex: 'q1', 'mat_03')
 * @property {string}        bncc         - Código da habilidade BNCC (ex: 'EF01LP03')
 * @property {string}        enunciado    - Texto da pergunta exibido ao aluno
 * @property {Alternativa[]} alternativas - Lista de 2–4 alternativas de resposta
 * @property {string}        correta      - id da alternativa correta
 * @property {string[]}      [bancoPalavras] - Pool de palavras para sortear e exibir no card
 * @property {string}        [palavra]    - Palavra fixa (usado quando bancoPalavras está vazio)
 */

/**
 * @typedef {Object} Alternativa
 * @property {string} id    - Chave única dentro da questão (ex: 'A', 'op1', 'sim')
 * @property {string} label - Texto exibido no botão/zona (ex: 'S', '5', 'Sim')
 */