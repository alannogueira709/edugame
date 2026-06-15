/**
 * theme-tokens.js
 * Dicionario de tokens semanticos para os temas NeuroBeep.
 * Nenhuma cor hex deve ser hardcoded fora deste arquivo.
 */

export const TOKENS = {
    COR_FUNDO_HUD:        { diurno: '#ffffff', foco: '#001225' },
    COR_TEXTO:            { diurno: '#000000', foco: '#FFFFFF' }, //#0003283
    COR_ICONE:            { diurno: '#FFD500', foco: '#FFD500' },
    COR_TEXTO_ICONE:      { diurno: '#00264F', foco: '#FFFFFF' },
    COR_BOTAO_IDLE:        { diurno: '#97D0FF', foco: '#002B5A' },
    COR_BOTAO_HOVER:       { diurno: '#80A6CF', foco: '#004C9E' },
    COR_BOTAO_PRESSED:     { diurno: '#6d9ccf', foco: '#C0D3E7' },
};

export const CONSTANTES = {
    DURACAO_TRANSICAO:   '250ms',
    EASING_TRANSICAO:    'ease-in-out',
    TAMANHO_MINIMO_TOQUE: 44,
    BORDA_ARREDONDADA:   '16px',
    SOMBRA_SUAVE:        '0 4px 12px rgba(0,38,79,0.15)',
};

/**
 * Gera objeto CSS custom properties para um tema especifico.
 * @param {string} tema - 'diurno' | 'foco'
 * @returns {Record<string, string>}
 */
export function gerarCSSProperties(tema) {
    const props = {};
    for (const [token, cores] of Object.entries(TOKENS)) {
        props[`--${token.toLowerCase().replace(/_/g, '-')}`] = cores[tema];
    }
    return props;
}
