/**
 * AudioNarrator.js
 * Sistema de narracao por audio para o NeuroBeep.
 * Usa arquivos de audio pre-gravados em assets/audios/.
 */

const AUDIO_BASE_PATH = 'assets/audios/';

const FASE_NOME = {
    1: 'um',
    2: 'dois',
    3: 'tres',
};

class AudioNarratorClass {
    constructor() {
        this._audio = null;
        this._volume = 1.0;
        this._muted = false;
    }

    init() {
        console.log('[AudioNarrator] Inicializado');
    }

    play(src) {
        if (this._muted) return;
        this.stop();
        this._audio = new Audio(src);
        this._audio.volume = this._volume;
        this._audio.play().catch(err => {
            console.warn('[AudioNarrator] Falha ao tocar:', src, err);
        });
    }

    stop() {
        if (this._audio) {
            this._audio.pause();
            this._audio.currentTime = 0;
            this._audio = null;
        }
    }

    setVolume(v) {
        this._volume = Math.max(0, Math.min(1, v));
        if (this._audio) this._audio.volume = this._volume;
    }

    mute() {
        this._muted = true;
        this.stop();
    }

    unmute() {
        this._muted = false;
    }

    get isMuted() { return this._muted; }

    playBoasVindas() {
        this.play(`${AUDIO_BASE_PATH}boas-vindas.wav`);
    }

    playFase(numeroFase) {
        const nome = FASE_NOME[numeroFase];
        if (!nome) return;
        this.play(`${AUDIO_BASE_PATH}fase-${nome}.wav`);
    }

    playFeedbackCorreto() {
        this.play(`${AUDIO_BASE_PATH}feedback-correto.wav`);
    }

    playFeedbackCompreensao() {
        this.play(`${AUDIO_BASE_PATH}feedback-compreensao.wav`);
    }

    playCompreensaoConsolidada(numeroFase) {
        const nome = FASE_NOME[numeroFase];
        if (!nome) return;
        this.play(`${AUDIO_BASE_PATH}compreensao-consolidada-fase-${nome}.wav`);
    }

    playResolucaoErroReincidente(numeroFase) {
        const nome = FASE_NOME[numeroFase];
        if (!nome) return;
        this.play(`${AUDIO_BASE_PATH}resolucao-erro-reincidente-fase-${nome}.wav`);
    }

    playOmissaoTimeout() {
        this.play(`${AUDIO_BASE_PATH}omissao-timeout.wav`);
    }

    playErroExecucao() {
        this.play(`${AUDIO_BASE_PATH}erro-execucao.wav`);
    }

    playOrientacaoEspacial() {
        this.play(`${AUDIO_BASE_PATH}orientacao-espacial.wav`);
    }

    playDica() {
        this.play(`${AUDIO_BASE_PATH}dica.wav`);
    }

    playReforcoPersistencia() {
        this.play(`${AUDIO_BASE_PATH}reforco-persistencia.wav`);
    }

    playErroReincidente() {
        this.play(`${AUDIO_BASE_PATH}erro-reincidente.wav`);
    }

    playFeedback(tipo, numeroFase) {
        switch (tipo) {
            case 'reforcao_positivo':
            case 'feedback_correto':
                this.playFeedbackCorreto();
                break;
            case 'compreensao':
            case 'feedback_compreensao':
                this.playFeedbackCompreensao();
                break;
            case 'explicacao_conteudo':
                if (numeroFase) {
                    this.playCompreensaoConsolidada(numeroFase);
                }
                break;
            case 'resolucao':
            case 'erro_cognitivo_reincidente':
                if (numeroFase) {
                    this.playResolucaoErroReincidente(numeroFase);
                } else {
                    this.playErroReincidente();
                }
                break;
            case 'omissao_timeout':
            case 'engajamento':
                this.playOmissaoTimeout();
                break;
            case 'alerta_execucao':
                this.playErroExecucao();
                break;
            case 'orientacao_espacial':
                this.playOrientacaoEspacial();
                break;
            case 'scaffolding':
            case 'dica':
                this.playDica();
                break;
            case 'reforcao_persistencia':
                this.playReforcoPersistencia();
                break;
            case 'incentivo':
                this.playDica();
                break;
            default:
                console.warn('[AudioNarrator] Tipo de feedback desconhecido:', tipo);
        }
    }
}

export const AudioNarrator = new AudioNarratorClass();
