// GameUI.js
// ============================================================
//  Gerencia toda a interface HTML da fase de jogo — versao acessivel.
//
//  Mudancas v2:
//    • HUD compacto: uma linha unica (score + lives + toggle tema)
//    • Texto nao essencial removido — substituido por icones SVG
//    • Enunciado removido da UI (entregue via audio)
//    • Modal simplificado (sem distancias detalhadas)
//    • Zonas ampliadas (88px altura, touch target >= 44px)
//    • Transicoes de cor 250ms para todos os elementos
//
//  NAO conhece p5.js, logica de jogo ou comunicacao com hardware.
// ============================================================

import { PHASE_STATE } from './QuestionLog.js';
import { ThemeManager, EVENT_NAME } from './ThemeManager.js';

const TIMEOUT_TOTAL_S = 60;
const CONFETTI_COLORS = [
    'hsl(193 95% 73%)', 'hsl(47 96% 62%)',
    'hsl(145 64% 58%)', 'hsl(0 0% 100%)',
    'hsl(42 98% 62%)',
];

/* SVG inline de icones (voce substituira por arquivos em assets/icons/) */
const ICON_STAR = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
const ICON_CLOCK = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z"/></svg>`;

export class GameUI {

    /** @param {number} phaseNumber */
    constructor(phaseNumber) {
        this._phaseNumber = phaseNumber;

        this._root            = null;
        this._resultModal     = null;
        this._scoreEl         = null;
        this._livesTrackEl    = null;
        this._timerShellEl    = null;
        this._timerBarFillEl  = null;
        this._timerValueEl    = null;
        this._questionProgEl  = null;
        this._challengeCardEl = null;
        this._wordTilesEl     = null;
        this._zonasEl         = null;
        this._themeToggleBtn  = null;
    }

    // ── CICLO DE VIDA ────────────────────────────────────────

    mount() {
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

    unmount() {
        this._root?.parentNode?.removeChild(this._root);
        this._resultModal?.parentNode?.removeChild(this._resultModal);
        this._themeToggleBtn?.parentNode?.removeChild(this._themeToggleBtn);
        this._root = this._resultModal = this._themeToggleBtn = null;
    }

    // ── BOTAO DE TOGGLE DE TEMA ─────────────────────────────

    _mountThemeToggle() {
        const btn = document.createElement('button');
        btn.className = 'theme-toggle';
        btn.setAttribute('aria-label', 'Mudar tema');
        btn.setAttribute('title', 'Mudar tema');
        const icon = document.createElement('img');
        icon.src = this._themeIconSrc();
        icon.alt = '';
        icon.setAttribute('aria-hidden', 'true');
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

        document.addEventListener(EVENT_NAME, () => {
            icon.src = this._themeIconSrc();
        });
    }

    _themeIconSrc() {
        return ThemeManager.tema === 'diurno'
            ? 'assets/icons/moon.svg'
            : 'assets/icons/sun.svg';
    }

    // ── ATUALIZACAO ──────────────────────────────────────────

    /**
     * Atualiza todos os valores da HUD de uma so vez.
     */
    update({ score, lives, questaoIndex, totalQuestoes, state, timerIncentivo, showTimer }) {
        if (this._scoreEl)        this._scoreEl.textContent = `${score}`;
        if (this._livesTrackEl)   this._livesTrackEl.innerHTML = this._livesHTML(lives);
        if (this._questionProgEl) this._questionProgEl.textContent = `${Math.max(1, questaoIndex + 1)}/${totalQuestoes}`;
        this._updateTimer(showTimer, timerIncentivo);
    }

    /** Atualiza o card de desafio (word tiles apenas — enunciado removido). */
    updateChallengeCard(enunciado, word, focusIndex = 0) {
        const w = String(word ?? '').trim();
        if (this._wordTilesEl) {
            if (w) {
                this._wordTilesEl.innerHTML = w.split('').map((char, i) =>
                    `<span class="word-tile${i === focusIndex ? ' word-tile-focus' : ''}">${char}</span>`
                ).join('');
                this._wordTilesEl.style.display = 'flex';
            } else {
                this._wordTilesEl.innerHTML = '';
                this._wordTilesEl.style.display = 'none';
            }
        }

        if (this._challengeCardEl) {
            this._challengeCardEl.style.display = w ? 'flex' : 'none';
        }
    }

    /**
     * Renderiza os botoes de zona de acordo com o estado atual.
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

        // Se os labels tem mais de 1 char, sao palavras — fonte menor
        if (alternativas?.some(a => a.label.length > 1)) {
            this._zonasEl.querySelectorAll('.zona-btn').forEach(b => b.classList.add('zona-btn-word'));
        }

        this._zonasEl.style.display = 'flex';

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

    // ── MODAL DE RESULTADO — SIMPLIFICADO ──────────────────

    showResultModal(isCorrect, data) {
        if (!this._resultModal) return;

        const q   = id => document.getElementById(id);
        const cls = isCorrect ? 'is-correct' : 'is-wrong';

        ['result-modal-bar', 'result-status-banner', 'result-status-icon',
         'result-status-title'].forEach(id => {
            const el = q(id);
            if (el) el.className = `${id} ${cls}`;
        });

        this._setContent('result-status-icon',   isCorrect ? '✓' : '✕');
        this._setContent('result-status-title',   isCorrect ? 'Acertou!' : 'Quase!');
        this._setContent('result-correct-label',  data.correctLabel);
        this._setContent('result-selected-label', data.selectedLabel);

        const marginPct = data.selectedDistance > 0
            ? (data.selectedDistance / Math.max(1, window.innerWidth) * 100).toFixed(1) + '%'
            : '0%';
        this._setContent('result-margin', marginPct);

        const btn = q('result-cta-btn');
        if (btn) {
            btn.textContent = isCorrect ? 'Continuar' : 'Tentar';
            btn.className   = `result-cta-btn ${cls}`;
        }

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

    // ── PRIVADOS — templates HTML ──────────────────────────

    _hudTemplate() {
        return `
        <div class="game-top-shell">
            <div class="game-header">
                <div class="hud-pill hud-pill-score">
                    <span class="hud-icon" aria-hidden="true">${ICON_STAR}</span>
                    <span class="hud-value" id="score-value">0</span>
                    <div class="lives-track" id="lives-track">${this._livesHTML(3)}</div>
                </div>
            </div>
            <div class="timer-shell" id="timer-shell">
                <span class="timer-icon" aria-hidden="true">${ICON_CLOCK}</span>
                <div class="timer-bar-track">
                    <div class="timer-bar-fill" id="timer-bar-fill"></div>
                </div>
                <span class="timer-value" id="timer-value">${TIMEOUT_TOTAL_S}s</span>
            </div>
        </div>

        <div class="game-challenge-card" id="challenge-card">
            <span class="challenge-progress" id="question-progress">1/1</span>
            <div class="game-word-tiles" id="word-tiles"></div>
        </div>

        <div class="game-zonas-html" id="zonas-html"></div>`;
    }

    _modalTemplate() {
        return `
        <div class="result-modal-card" id="result-modal-card">
            <div class="confetti-container" id="confetti-container"></div>
            <div class="result-modal-bar" id="result-modal-bar"></div>
            <div class="result-modal-body">
                <div class="result-status-banner" id="result-status-banner">
                    <div class="result-status-icon" id="result-status-icon"></div>
                    <div class="result-status-title" id="result-status-title"></div>
                </div>
                <div class="result-info-block">
                    <div class="result-info-row">
                        <span class="result-info-label">Correta:</span>
                        <span class="result-info-value" id="result-correct-label"></span>
                    </div>
                    <div class="result-info-row">
                        <span class="result-info-label">Sua:</span>
                        <span class="result-info-value" id="result-selected-label"></span>
                    </div>
                    <div class="result-info-row">
                        <span class="result-info-label">Margem:</span>
                        <span class="result-info-value" id="result-margin"></span>
                    </div>
                </div>
                <button class="result-cta-btn" id="result-cta-btn"></button>
            </div>
        </div>`;
    }

    // ── PRIVADOS — helpers ──────────────────────────────────

    _cacheRefs() {
        const q = id => this._root.querySelector(`#${id}`);
        this._scoreEl         = q('score-value');
        this._livesTrackEl    = q('lives-track');
        this._timerShellEl    = q('timer-shell');
        this._timerBarFillEl  = q('timer-bar-fill');
        this._timerValueEl    = q('timer-value');
        this._questionProgEl  = q('question-progress');
        this._challengeCardEl = q('challenge-card');
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
            `<svg class="life-chip${i < lives ? '' : ' is-lost'}" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>`
        ).join('');
    }

    _setContent(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }
}
