/**
 * ThemeManager.js
 * Singleton de gerenciamento de temas NeuroBeep.
 * Responsabilidades:
 *   - Carregar/salvar preferencia de tema (localStorage)
 *   - Aplicar classe CSS no <html> para ativar tema
 *   - Notificar ouvintes via evento customizado
 *   - Fornecer cores via tokens
 */

import { TOKENS, CONSTANTES } from './theme-tokens.js';

const STORAGE_KEY = 'neurobeep_tema';
const EVENT_NAME  = 'neurobeep:tema-alterado';

class ThemeManagerClass {
    constructor() {
        this._tema = this._carregarPreferencia() || 'diurno';
        this._aplicarClasse();
    }

    /** Tema atual: 'diurno' | 'foco' */
    get tema() { return this._tema; }

    /** Retorna a cor de um token para o tema ativo. */
    getCor(token) {
        const t = TOKENS[token];
        if (!t) { console.warn('[ThemeManager] Token desconhecido:', token); return '#000000'; }
        return t[this._tema];
    }

    /** Retorna o valor de uma constante. */
    getConstante(nome) {
        return CONSTANTES[nome];
    }

    /** Alterna entre diurno e foco, persiste e notifica. */
    toggle() {
        this._tema = (this._tema === 'diurno') ? 'foco' : 'diurno';
        this._salvarPreferencia();
        this._aplicarClasse();
        this._notificar();
    }

    /** Define tema explicitamente. */
    setTema(tema) {
        if (!TOKENS.COR_FUNDO_HUD[tema]) {
            console.warn('[ThemeManager] Tema invalido:', tema);
            return;
        }
        this._tema = tema;
        this._salvarPreferencia();
        this._aplicarClasse();
        this._notificar();
    }

    /** Inicializa — chamado no sketch.setup() */
    init() {
        this._aplicarClasse();
    }

    // --- Privados ---

    _salvarPreferencia() {
        try { localStorage.setItem(STORAGE_KEY, this._tema); }
        catch (e) { console.warn('[ThemeManager] Nao foi possivel salvar tema:', e); }
    }

    _carregarPreferencia() {
        try { return localStorage.getItem(STORAGE_KEY); }
        catch (e) { return null; }
    }

    _aplicarClasse() {
        const html = document.documentElement;
        html.classList.remove('theme-diurno', 'theme-foco');
        html.classList.add(`theme-${this._tema}`);

        // Aplica TODOS os tokens como CSS variables no <html>
        // Isso torna theme-tokens.js a UNICA fonte de verdade para cores
        for (const [token, cores] of Object.entries(TOKENS)) {
            const varName = `--${token.toLowerCase().replace(/_/g, '-')}`;
            html.style.setProperty(varName, cores[this._tema]);
        }
    }

    _notificar() {
        const event = new CustomEvent(EVENT_NAME, {
            detail: { tema: this._tema },
            bubbles: true,
        });
        document.dispatchEvent(event);
    }
}

export const ThemeManager = new ThemeManagerClass();
export { EVENT_NAME, STORAGE_KEY };
