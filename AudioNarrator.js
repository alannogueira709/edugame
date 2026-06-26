/**
 * AudioNarrator.js
 * Sistema de narracao por audio para o NeuroBeep.
 * Usa arquivos .wav pre-gravados em assets/audio/.
 */

const AUDIO_BASE_PATH = 'assets/audio/';

/* Mapeamento tipo de feedback → arquivo .wav (conforme dublagem.yaml) */
const FEEDBACK_MAP = {
    reforcao_positivo:          'feedback-correto.wav',
    reforcao_persistencia:      'reforco-persistencia.wav',
    scaffolding:                'dica.wav',
    incentivo:                  'feedback-compreensao.wav',
    compreensao:                'feedback-compreensao.wav',
    engajamento:                'omissao-timeout.wav',
    alerta_execucao:            'erro-execucao.wav',
    orientacao_espacial:        'orientacao-espacial.wav',
    erro_cognitivo_reincidente: 'erro-reincidente.wav',
    resolucao:                  null, // usa RESOLUCAO_POR_FASE
    explicacao_conteudo:        'feedback-correto.wav',
};

/* Mapeamento fase → arquivo de enunciado .wav */
const ENUNCIADO_POR_FASE = {
    1: 'fase-um.wav',
    2: 'fase-dois.wav',
    3: 'fase-tres.wav',
};

/* Mapeamento fase → resolucao .wav */
const RESOLUCAO_POR_FASE = {
    1: 'resolucao-erro-reincidente-fase-um.wav',
    2: 'resolucao-erro-reincidente-fase-dois.wav',
    3: 'resolucao-erro-reincidente-fase-tres.wav',
};

/* Compreensao consolidada por fase */
const COMPREENSAO_POR_FASE = {
    1: 'compreensao-consolidada-fase-um.wav',
    2: 'compreensao-consolidada-fase-dois.wav',
    3: 'compreensao-consolidada-fase-tres.wav',
};

class AudioNarratorClass {
    constructor() {
        this._audio = null;
        this._volume = 1.0;
        this._muted = false;
        this._faseAtual = 1;
        this._playId = 0; // contador de concurrencia
    }

    init() {
        console.log('[AudioNarrator] Inicializado');
    }

    /** Define a fase atual para escolher audios especificos. */
    setFase(n) {
        this._faseAtual = n;
    }

    async play(src) {
        if (this._muted) return;
        this.stop();
        if (!src) return;

        const myId = ++this._playId;

        try {
            const res = await fetch(src, { method: 'HEAD' });
            if (!res.ok) return;
        } catch (_) {
            return;
        }

        // Outro audio foi disparado enquanto este verificava existencia
        if (this._playId !== myId) return;

        this._audio = new Audio(src);
        this._audio.volume = this._volume;
        this._audio.play().catch(() => {});
    }

    stop() {
        this._playId++;
        if (this._audio) {
            this._audio.pause();
            this._audio.currentTime = 0;
            this._audio = null;
        }
    }

    /** Narra o enunciado da questao com base na fase. */
    playEnunciado(questaoId) {
        const file = ENUNCIADO_POR_FASE[this._faseAtual];
        if (file) this.play(`${AUDIO_BASE_PATH}${file}`);
    }

    /** Narra um feedback pedagogico pelo tipo. */
    playFeedback(tipo) {
        let file;
        if (tipo === 'resolucao') {
            file = RESOLUCAO_POR_FASE[this._faseAtual];
        } else if (tipo === 'reforcao_positivo') {
            file = COMPREENSAO_POR_FASE[this._faseAtual];
        } else {
            file = FEEDBACK_MAP[tipo];
        }
        if (file) this.play(`${AUDIO_BASE_PATH}${file}`);
    }

    setVolume(v) {
        this._volume = Math.max(0, Math.min(1, v));
        if (this._audio) this._audio.volume = this._volume;
    }

    mute()   { this._muted = true;  this.stop(); }
    unmute() { this._muted = false; }

    get isMuted() { return this._muted; }
}

export const AudioNarrator = new AudioNarratorClass();
