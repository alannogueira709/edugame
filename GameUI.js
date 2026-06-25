// GameUI.js
// ============================================================
//  Gerencia toda a interface HTML da fase de jogo.
//
//  Responsabilidades:
//    • Criar e remover os elementos DOM (HUD, challenge card,
//      zonas de resposta, modal de resultado)
//    • Atualizar valores a cada frame via update()
//    • Exibir/esconder o modal de resultado com confetti
//
//  NÃO conhece p5.js, lógica de jogo ou comunicação com hardware.
//  Recebe dados simples (strings, números, booleanos) e reflete no DOM.
//
//  USO:
//    const ui = new GameUI(phaseNumber);
//    ui.mount();
//    // no draw():
//    ui.update({ score, lives, questaoIndex, totalQuestoes, state, timerIncentivo, showTimer });
//    ui.updateChallengeCard(enunciado, word);
//    ui.updateZones(alternativas, state, correctaId);
//    ui.showResultModal(isCorrect, { ... });
//    // no cleanup():
//    ui.unmount();
// ============================================================

import { PHASE_STATE } from './QuestionLog.js';
import { ThemeManager, EVENT_NAME } from './ThemeManager.js';

// Mensagens do status bar por estado
const STATUS_MSGS = {};

const STATUS_ATIVOS = new Set([
    PHASE_STATE.ESPERA_ATIVA,
    PHASE_STATE.ESPERA_INCENTIVO,
    PHASE_STATE.ESPERA_2,
]);

const TIMEOUT_TOTAL_S = 60;
const CONFETTI_COLORS = [
    'hsl(193 95% 73%)', 'hsl(47 96% 62%)',
    'hsl(145 64% 58%)', 'hsl(0 0% 100%)',
    'hsl(42 98% 62%)',
];

export class GameUI {

    /** @param {number} phaseNumber */
    constructor(phaseNumber) {
        this._phaseNumber = phaseNumber;

        // Referências DOM (preenchidas em mount())
        this._root            = null;
        this._resultModal     = null;
        this._scoreEl         = null;
        this._phaseEl         = null;
        this._livesTrackEl    = null;
        this._timerShellEl    = null;
        this._timerBarFillEl  = null;
        this._timerValueEl    = null;
        this._statusMsgEl     = null;
        this._questionProgEl  = null;
        this._challengeCardEl = null;
        this._enunciadoEl     = null;
        this._wordTilesEl     = null;
        this._zonasEl         = null;
        this._themeToggleBtn  = null;
    }

    // ──────────────────────────────────────────────────────────
    //  CICLO DE VIDA
    // ──────────────────────────────────────────────────────────

    /** Cria os elementos DOM e os insere no body. */
    mount() {
        // Esconde a landing overlay se ainda estiver visível
        const overlay = document.querySelector('.content-overlay');
        if (overlay) overlay.style.display = 'none';

        this._root = document.createElement('div');
        this._root.className = 'game-ui';
        this._root.innerHTML = this._hudTemplate();
        document.body.appendChild(this._root);

        this._resultModal = document.createElement('div');
        this._resultModal.className = 'result-modal-backdrop hidden';
        this._resultModal.innerHTML = this._modalTemplate();
        document.body.appendChild(this._resultModal);

        this._mountThemeToggle();
        this._cacheRefs();
    }

    /** Remove todos os elementos DOM criados por mount(). */
    unmount() {
        this._root?.parentNode?.removeChild(this._root);
        this._resultModal?.parentNode?.removeChild(this._resultModal);
        this._themeToggleBtn?.parentNode?.removeChild(this._themeToggleBtn);
        this._root = this._resultModal = null;
        this._themeToggleBtn = null;
    }

    // ──────────────────────────────────────────────────────────
    //  BOTAO DE TOGGLE DE TEMA
    // ──────────────────────────────────────────────────────────

    _mountThemeToggle() {
        const btn = document.createElement('button');
        btn.className = 'theme-toggle';
        btn.setAttribute('aria-label', 'Mudar tema');
        btn.setAttribute('title', 'Mudar tema');
        const icon = document.createElement('img');
        icon.src = this._themeIconSrc();
        icon.alt = '';
        btn.appendChild(icon);

        btn.addEventListener('click', () => {
            ThemeManager.toggle();
            const label = ThemeManager.tema === 'diurno' ? 'Mudar para modo foco' : 'Mudar para modo diurno';
            btn.setAttribute('aria-label', label);
            btn.setAttribute('title', label);
            icon.src = this._themeIconSrc();
        });

        document.body.appendChild(btn);
        this._themeToggleBtn = btn;

        // Atualiza ícone quando o tema muda externamente
        document.addEventListener(EVENT_NAME, () => {
            icon.src = this._themeIconSrc();
        });
    }

    _themeIconSrc() {
        return ThemeManager.tema === 'diurno'
            ? 'assets/icons/sun.svg'
            : 'assets/icons/moon.svg';
    }

    // ──────────────────────────────────────────────────────────
    //  ATUALIZAÇÃO — chamada a cada frame
    // ──────────────────────────────────────────────────────────

    /**
     * Atualiza todos os valores da HUD de uma só vez.
     * @param {{ score: number, lives: number, questaoIndex: number,
     *            totalQuestoes: number, state: string,
     *            timerIncentivo: number, showTimer: boolean }} data
     */
    update({ score, lives, questaoIndex, totalQuestoes, state, timerIncentivo, showTimer }) {
        if (this._scoreEl)        this._scoreEl.textContent        = `${score} pts`;
        if (this._phaseEl)        this._phaseEl.textContent        = `Fase ${this._phaseNumber}`;
        if (this._livesTrackEl)   this._livesTrackEl.innerHTML     = this._livesHTML(lives);
        if (this._questionProgEl) this._questionProgEl.textContent = `${Math.max(1, questaoIndex + 1)}/${totalQuestoes}`;
        if (this._statusMsgEl)    this._statusMsgEl.textContent    = this._statusMsg(state);
        this._updateTimer(showTimer, timerIncentivo);
    }

    /** Atualiza o card de desafio (enunciado + tiles da palavra). */
    updateChallengeCard(enunciado, word) {
        if (this._enunciadoEl)   this._enunciadoEl.textContent = enunciado ?? '';

        const w = String(word ?? '').trim();
        if (this._wordTilesEl) {
            if (w) {
                this._wordTilesEl.innerHTML = w.split('').map((char, i) =>
                    `<span class="word-tile${i === 0 ? ' word-tile-focus' : ''}">${char}</span>`
                ).join('');
                this._wordTilesEl.style.display = 'flex';
            } else {
                this._wordTilesEl.innerHTML = '';
                this._wordTilesEl.style.display = 'none';
            }
        }

        if (this._challengeCardEl) {
            this._challengeCardEl.style.display = enunciado ? 'flex' : 'none';
        }
    }

    /**
     * Renderiza os botões de zona de acordo com o estado atual.
     * @param {import('./GameBridge.js').Alternativa[]} alternativas
     * @param {string} state      - Estado atual da máquina
     * @param {string} correctaId - id da alternativa correta (para highlight no FEEDBACK_FINAL)
     */
    updateZones(alternativas, state, correctaId) {
        if (!this._zonasEl) return;

        if (state === PHASE_STATE.COMPREENSAO) {
            this._zonasEl.innerHTML = `
                <button class="zona-btn zona-btn-compreh" data-zona-id="sabia">💡 Eu sabia!</button>
                <button class="zona-btn zona-btn-compreh" data-zona-id="chutei">🎲 Foi chute</button>`;
        } else {
            this._zonasEl.innerHTML = (alternativas ?? []).map(alt =>
                `<button class="zona-btn" data-zona-id="${alt.id}">${alt.label}</button>`
            ).join('');
        }

        this._zonasEl.style.display = 'flex';

        // Destaca correta no estado de feedback final
        if (state === PHASE_STATE.FEEDBACK_FINAL && correctaId) {
            this._zonasEl.querySelectorAll('.zona-btn').forEach(btn => {
                if (btn.dataset.zonaId === correctaId) btn.classList.add('zona-btn-correct');
                else btn.classList.add('zona-btn-dim');
            });
        }
    }

    hideZones() {
        if (this._zonasEl) this._zonasEl.style.display = 'none';
    }

    // ──────────────────────────────────────────────────────────
    //  MODAL DE RESULTADO
    // ──────────────────────────────────────────────────────────

    /**
     * Exibe o modal de resultado após uma parada.
     *
     * @param {boolean} isCorrect
     * @param {{ correctLabel: string, selectedLabel: string,
     *            selectedDistance: number,
     *            alternativas: import('./GameBridge.js').Alternativa[],
     *            zones: Array<{id,label,x,w,isCorrect}>,
     *            playerAnchorX: number }} data
     */
    showResultModal(isCorrect, data) {
        if (!this._resultModal) return;

        const q   = id => document.getElementById(id);
        const cls = isCorrect ? 'is-correct' : 'is-wrong';

        // Classes de cor
        ['result-modal-bar', 'result-status-banner', 'result-status-icon',
         'result-status-title', 'result-status-sub'].forEach(id => {
            const el = q(id);
            if (el) el.className = `${id} ${cls}`;
        });

        // Textos
        this._setContent('result-status-icon',   isCorrect ? '✓' : '✕');
        this._setContent('result-status-title',   isCorrect ? 'Acertou em cheio!' : 'Poxa, quase lá.');
        this._setContent('result-status-sub',     isCorrect ? '+10 Pontos' : '-1 Vida');
        this._setContent('result-correct-label',  data.correctLabel);
        this._setContent('result-selected-label', data.selectedLabel);

        const marginPct = data.selectedDistance > 0
            ? (data.selectedDistance / Math.max(1, window.innerWidth) * 100).toFixed(1) + '%'
            : '0%';
        this._setContent('result-margin', marginPct);

        // Grid de distâncias por alternativa
        const grid = q('result-distances-grid');
        if (grid) {
            grid.innerHTML = (data.alternativas ?? []).map(alt => {
                const zona  = (data.zones ?? []).find(z => z.id === alt.id);
                const dist  = zona ? Math.abs(data.playerAnchorX - (zona.x + zona.w / 2)) : 0;
                const pct   = (dist / Math.max(1, window.innerWidth) * 100).toFixed(1);
                const isSel = alt.label === data.selectedLabel;
                return `<div class="result-dist-chip${isSel ? ' is-selected' : ''}">
                    <span class="result-dist-label">${alt.label}</span>
                    <span class="result-dist-value">${pct}%</span>
                </div>`;
            }).join('');
        }

        // Botão CTA
        const btn = q('result-cta-btn');
        if (btn) {
            btn.textContent = isCorrect ? 'Próxima Fase' : 'Tentar Novamente';
            btn.className   = `result-cta-btn ${cls}`;
        }

        // Confetti
        const confettiEl = q('confetti-container');
        if (confettiEl) {
            confettiEl.innerHTML = '';
            if (isCorrect) {
                for (let i = 0; i < 28; i++) {
                    const el       = document.createElement('div');
                    el.className   = 'confetti-piece';
                    el.style.cssText = [
                        `left:${Math.random() * 100}%`,
                        `background:${CONFETTI_COLORS[i % CONFETTI_COLORS.length]}`,
                        `--dur:${(0.9 + Math.random() * 0.8).toFixed(2)}s`,
                        `--delay:${(Math.random() * 0.5).toFixed(2)}s`,
                        `transform:rotate(${Math.round(Math.random() * 360)}deg)`,
                    ].join(';');
                    confettiEl.appendChild(el);
                }
            }
        }

        this._resultModal.classList.remove('hidden');
    }

    hideResultModal() {
        this._resultModal?.classList.add('hidden');
    }

    // ──────────────────────────────────────────────────────────
    //  PRIVADOS — templates HTML
    // ──────────────────────────────────────────────────────────

    _hudTemplate() {
        return `
        <div class="game-top-shell">
            <div class="game-header">
                <div class="hud-pill hud-pill-score">
                    <span class="hud-icon" aria-hidden="true">&#9733;</span>
                    <span class="hud-value" id="score-value">0 pts</span>
                </div>
                <div class="hud-pill hud-pill-phase">
                    <span class="hud-value" id="phase-value">Fase ${this._phaseNumber}</span>
                </div>
                <div class="hud-pill hud-pill-lives">
                    <div class="lives-track" id="lives-track">${this._livesHTML(3)}</div>
                </div>
            </div>
            <div class="timer-shell" id="timer-shell">
                <span class="timer-label">Tempo</span>
                <div class="timer-bar-track">
                    <div class="timer-bar-fill" id="timer-bar-fill"></div>
                </div>
                <span class="timer-value" id="timer-value">${TIMEOUT_TOTAL_S}s</span>
            </div>
        </div>

        <div class="game-challenge-card" id="challenge-card">
            <p class="game-enunciado" id="enunciado-text"></p>
            <div class="game-word-tiles" id="word-tiles"></div>
        </div>

        <div class="game-zonas-html" id="zonas-html"></div>

        <div class="game-statusbar">
            <span class="status-copy" id="status-message">Espaço move e para o robô. Use as setas para trocar a direção.</span>
            <span class="status-chip" id="question-progress">1/1</span>
        </div>`;
    }

    _modalTemplate() {
        return `
        <div class="result-modal-card" id="result-modal-card">
            <div class="confetti-container" id="confetti-container"></div>
            <div class="result-modal-bar"  id="result-modal-bar"></div>
            <div class="result-modal-body">
                <p class="result-modal-title">Resultado da Parada</p>
                <div class="result-status-banner" id="result-status-banner">
                    <div class="result-status-icon"  id="result-status-icon"></div>
                    <div class="result-status-title" id="result-status-title"></div>
                    <div class="result-status-sub"   id="result-status-sub"></div>
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
                <p class="result-distances-title">Distâncias detalhadas:</p>
                <div class="result-distances-grid" id="result-distances-grid"></div>
                <button class="result-cta-btn" id="result-cta-btn"></button>
            </div>
        </div>`;
    }

    // ──────────────────────────────────────────────────────────
    //  PRIVADOS — helpers
    // ──────────────────────────────────────────────────────────

    _cacheRefs() {
        const q = id => this._root.querySelector(`#${id}`);
        this._scoreEl         = q('score-value');
        this._phaseEl         = q('phase-value');
        this._livesTrackEl    = q('lives-track');
        this._timerShellEl    = q('timer-shell');
        this._timerBarFillEl  = q('timer-bar-fill');
        this._timerValueEl    = q('timer-value');
        this._statusMsgEl     = q('status-message');
        this._questionProgEl  = q('question-progress');
        this._challengeCardEl = q('challenge-card');
        this._enunciadoEl     = q('enunciado-text');
        this._wordTilesEl     = q('word-tiles');
        this._zonasEl         = q('zonas-html');
    }

    _updateTimer(show, value) {
        if (!this._timerShellEl || !this._timerBarFillEl) return;
        if (show && value > 0) {
            const pct = Math.max(0, (value / TIMEOUT_TOTAL_S) * 100).toFixed(1);
            this._timerShellEl.classList.add('is-visible');
            this._timerBarFillEl.style.width = `${pct}%`;
            if (this._timerValueEl) this._timerValueEl.textContent = `${value}s`;
        } else {
            this._timerShellEl.classList.remove('is-visible');
            this._timerBarFillEl.style.width = '100%';
            if (this._timerValueEl) this._timerValueEl.textContent = `${TIMEOUT_TOTAL_S}s`;
        }
    }

    _livesHTML(lives) {
        return Array.from({ length: 3 }, (_, i) =>
            `<span class="life-chip${i < lives ? '' : ' is-lost'}" aria-hidden="true"></span>`
        ).join('');
    }

    _statusMsg(state) {
        if (STATUS_MSGS[state]) return STATUS_MSGS[state];
        if (STATUS_ATIVOS.has(state)) return 'Espaço move e para o robô. Use as setas para trocar a direção.';
        return 'Acompanhe o desafio e aguarde o próximo passo do jogo.';
    }

    _setContent(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }
}