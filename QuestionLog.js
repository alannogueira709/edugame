// QuestionLog.js
// ============================================================
//  Constantes e classe de log pedagógico do NeuroBeep.
//
//  Exporta:
//    STATUS_RESPOSTA  — códigos de resultado de cada jogada
//    PHASE_STATE      — estados da máquina de estados da fase
//    QuestionLog      — "bilhete de identidade" de uma questão
// ============================================================

// ── Códigos de resultado (doc §8, Grupo C) ───────────────────
export const STATUS_RESPOSTA = {
    ACERTO_CONSOLIDADO: 1, // Acertou de 1ª e confirmou que sabia
    ACERTO_ASSISTIDO:   2, // Acertou na 2ª tentativa após dica
    ACERTO_CASUAL:      3, // Acertou de 1ª, mas disse que chutou
    ERRO_COGNITIVO:     4, // Errou nas duas tentativas
    OMISSAO_TIMEOUT:    5, // Tempo esgotado, aluno não interagiu
    ERRO_EXECUCAO:      6, // Moveu mas não parou / passou direto
    ERRO_ESPACIAL:      7, // Parou em zona neutra (entre alternativas)
};

// ── Estados da máquina de estados ────────────────────────────
export const PHASE_STATE = {
    IDLE:                   'idle',
    APRESENTACAO:           'apresentacao',
    ESPERA_ATIVA:           'espera_ativa',
    ESPERA_INCENTIVO:       'espera_incentivo',
    DECISAO_1:              'decisao_1',
    COMPREENSAO:            'compreensao',
    FEEDBACK_ERRO:          'feedback_erro',
    ESPERA_2:               'espera_2',
    DECISAO_2:              'decisao_2',
    FEEDBACK_FINAL:         'feedback_final',
    ENCERRAMENTO:           'encerramento',
    AGUARDANDO_PROXIMA:     'aguardando_proxima',
    AGUARDANDO_COMPREENSAO: 'aguardando_compreensao',
    RECALIBRANDO:           'recalibrando',
};

// ── createQuestion — factory com validação ────────────────────
/**
 * Cria e valida um objeto Questao.
 * Lança um erro descritivo se campos obrigatórios estiverem
 * ausentes ou incorretos — facilita depuração ao montar roteiros.
 *
 * @param {Questao} params
 * @returns {Readonly<Questao>}
 *
 * @example
 * import { createQuestion } from './QuestionLog.js';
 *
 * const q = createQuestion({
 *   id: 'q1',
 *   bncc: 'EF01LP01',
 *   enunciado: 'Qual letra faz o som de "SSS"?',
 *   alternativas: [
 *     { id: 'A', label: 'A' },
 *     { id: 'S', label: 'S' },
 *     { id: 'M', label: 'M' },
 *   ],
 *   correta: 'S',
 *   bancoPalavras: ['SAPO', 'SELO', 'SINO'],
 * });
 */
export function createQuestion({
    id,
    bncc          = '',
    enunciado,
    alternativas,
    correta,
    bancoPalavras = [],
    palavra       = '',
    audioUrl      = null,
    midia         = {},
}) {
    if (!id || typeof id !== 'string')
        throw new Error('[createQuestion] "id" é obrigatório e deve ser string.');
    if (!enunciado || typeof enunciado !== 'string')
        throw new Error(`[createQuestion] (${id}): "enunciado" é obrigatório.`);
    if (!Array.isArray(alternativas) || alternativas.length < 2)
        throw new Error(`[createQuestion] (${id}): "alternativas" deve ter ao menos 2 itens.`);
    if (alternativas.length > 4)
        console.warn(`[createQuestion] (${id}): mais de 4 alternativas pode prejudicar o layout.`);

    const ids = alternativas.map(a => a.id);
    if (!ids.includes(correta))
        throw new Error(
            `[createQuestion] (${id}): "correta" ("${correta}") não corresponde a ` +
            `nenhum id de alternativa: [${ids.join(', ')}].`
        );

    return Object.freeze({
        id,
        bncc,
        enunciado,
        alternativas: alternativas.map(a => Object.freeze({ id: a.id, label: a.label })),
        correta,
        bancoPalavras: Array.isArray(bancoPalavras) ? [...bancoPalavras] : [],
        palavra:       typeof palavra === 'string' ? palavra : '',
        audioUrl,
        midia:         typeof midia === 'object' ? midia : {},
    });
}

// ── QuestionLog ───────────────────────────────────────────────
/**
 * Registra todos os dados pedagógicos de uma única jogada.
 * Instanciado pelo GamePhase no início de cada questão e
 * serializado via toPayload() ao ser enviado ao backend.
 */
export class QuestionLog {

    /**
     * @param {string}      sessaoId       - ID da sessão corrente
     * @param {number}      faseAtual      - Número da fase
     * @param {string}      questaoId      - ID da questão (ex: 'q1')
     * @param {string}      habilidadeBNCC - Código BNCC (ex: 'EF01LP03')
     * @param {string|null} gabaritoId     - ID da alternativa correta
     */
    constructor(sessaoId, faseAtual, questaoId, habilidadeBNCC, gabaritoId) {
        this.sessao_id  = sessaoId;
        this.fase_atual = faseAtual;

        this.contexto_pedagogico = {
            id_questao:      questaoId,
            habilidade_bncc: habilidadeBNCC,
            gabarito_zona:   gabaritoId,
            dica_oferecida:  false,
        };

        this.cronometria_sincronizada = {
            t_exibicao_pergunta:  null,
            t_primeiro_movimento: null,
            t_parada_final:       null,
            t_inicio_feedback:    null,
            t_fim_feedback:       null,
        };

        this.dinamica_neuro_motora = {
            tempo_latencia_ms:  null,
            quedas_de_foco_qty: 0,
        };

        this.precisao_odometrica = {
            posicao_inicial_passos:   null,
            posicao_final_passos:     null,
            alvo_esperado_passos_min: null,
            alvo_esperado_passos_max: null,
            distancia_erro_passos:    0,
            micro_hesitacoes:         0,
        };

        this.resolucao_final = {
            zona_parada:             null,
            status_resposta_cod:     null,
            status_resposta_desc:    null,
            verificacao_compreensao: null,
            resposta_escolhida_1:    null,
            resposta_escolhida_2:    null,
            tentativas:              0,
        };

        /** @private */ this._roboEstavaAndando = false;
        /** @private */ this._payloadEnviado    = false;
    }

    // ── Marcação de eventos ──────────────────────────────────

    marcarExibicao() {
        this.cronometria_sincronizada.t_exibicao_pergunta = Date.now();
    }

    marcarInicioFeedback() {
        if (!this.cronometria_sincronizada.t_inicio_feedback) {
            this.cronometria_sincronizada.t_inicio_feedback = Date.now();
        }
    }

    marcarFimFeedback() {
        this.cronometria_sincronizada.t_fim_feedback = Date.now();
    }

    // ── Registro incremental ─────────────────────────────────

    registrarMovimento(isMoving, posicaoAtualPassos) {
        const tAtual = Date.now();

        if (isMoving && !this.cronometria_sincronizada.t_primeiro_movimento) {
            this.cronometria_sincronizada.t_primeiro_movimento = tAtual;
            const tExibicao = this.cronometria_sincronizada.t_exibicao_pergunta ?? tAtual;
            this.dinamica_neuro_motora.tempo_latencia_ms         = tAtual - tExibicao;
            this.precisao_odometrica.posicao_inicial_passos      = posicaoAtualPassos;
        }

        if (!isMoving && this._roboEstavaAndando && !this.cronometria_sincronizada.t_parada_final) {
            this.precisao_odometrica.micro_hesitacoes       += 1;
            this.dinamica_neuro_motora.quedas_de_foco_qty   += 1;
        }

        this._roboEstavaAndando = isMoving;
    }

    registrarRespostaEscolhida(tentativa, zonaId) {
        if (tentativa === 1) this.resolucao_final.resposta_escolhida_1 = zonaId;
        if (tentativa === 2) this.resolucao_final.resposta_escolhida_2 = zonaId;
        this.resolucao_final.tentativas = Math.max(this.resolucao_final.tentativas, tentativa);
    }

    registrarTentativa(n) {
        this.resolucao_final.tentativas = Math.max(this.resolucao_final.tentativas, n);
    }

    registrarDicaOferecida() {
        this.contexto_pedagogico.dica_oferecida = true;
    }

    registrarAlvoEsperado(passoMin, passoMax) {
        this.precisao_odometrica.alvo_esperado_passos_min = passoMin;
        this.precisao_odometrica.alvo_esperado_passos_max = passoMax;
    }

    // ── Finalização ──────────────────────────────────────────

    finalizarJogada(statusCod, zonaParadaId, posicaoFinalPassos, verificacaoCompreensao = null) {
        this.cronometria_sincronizada.t_parada_final           = Date.now();
        this.resolucao_final.status_resposta_cod               = statusCod;
        this.resolucao_final.status_resposta_desc              = this._descreverStatus(statusCod);
        this.resolucao_final.zona_parada                       = zonaParadaId;
        this.resolucao_final.verificacao_compreensao           = verificacaoCompreensao;
        this.precisao_odometrica.posicao_final_passos          = posicaoFinalPassos;
        this.precisao_odometrica.distancia_erro_passos         = this._calcularDistanciaErro(posicaoFinalPassos);
    }

    /** Retorna o objeto serializado para envio ao backend. */
    toPayload() {
        const { _roboEstavaAndando, _payloadEnviado, ...valido } = this;
        return valido;
    }

    // ── Privados ─────────────────────────────────────────────

    _calcularDistanciaErro(pos) {
        const { alvo_esperado_passos_min: min, alvo_esperado_passos_max: max } = this.precisao_odometrica;
        if (!Number.isFinite(pos) || !Number.isFinite(min) || !Number.isFinite(max)) return 0;
        if (pos < min) return Math.round(min - pos);
        if (pos > max) return Math.round(pos - max);
        return 0;
    }

    _descreverStatus(cod) {
        return ({
            1: 'Acerto Consolidado',
            2: 'Acerto Assistido',
            3: 'Acerto Casual',
            4: 'Erro Cognitivo',
            5: 'Omissão / Timeout',
            6: 'Erro de Execução',
            7: 'Erro Espacial',
        })[cod] ?? 'Desconhecido';
    }
}