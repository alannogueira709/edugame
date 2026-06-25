/**
 * AudioNarrator.js
 * Sistema de narracao por audio para o NeuroBeep.
 * Usa arquivos de audio pre-gravados em assets/audio/.
 *
 * Estrutura esperada de arquivos:
 *   assets/audio/
 *     ├── enunciado_q1.mp3
 *     ├── enunciado_q2.mp3
 *     ├── enunciado_mat_q1.mp3
 *     ├── reforco_positivo.mp3
 *     ├── reforco_persistencia.mp3
 *     ├── scaffolding.mp3
 *     ├── incentivo.mp3
 *     ├── compreensao.mp3
 *     └── ...
 */

const AUDIO_BASE_PATH = 'assets/audio/';

class AudioNarratorClass {
    constructor() {
        this._audio = null;
        this._volume = 1.0;
        this._muted = false;
    }

    /** Inicializa o sistema de audio. */
    init() {
        console.log('[AudioNarrator] Inicializado');
    }

    /** Toca um arquivo de audio pelo caminho relativo. */
    play(src) {
        if (this._muted) return;
        this.stop();
        this._audio = new Audio(src);
        this._audio.volume = this._volume;
        this._audio.play().catch(err => {
            console.warn('[AudioNarrator] Falha ao tocar:', src, err);
        });
    }

    /** Para a narracao atual. */
    stop() {
        if (this._audio) {
            this._audio.pause();
            this._audio.currentTime = 0;
            this._audio = null;
        }
    }

    /** Narra o enunciado de uma questao pelo ID. */
    playEnunciado(questaoId) {
        const src = `${AUDIO_BASE_PATH}enunciado_${questaoId}.mp3`;
        this.play(src);
    }

    /** Narra um feedback pedagogico pelo tipo. */
    playFeedback(tipo) {
        const src = `${AUDIO_BASE_PATH}${tipo}.mp3`;
        this.play(src);
    }

    /** Controla volume (0.0 a 1.0). */
    setVolume(v) {
        this._volume = Math.max(0, Math.min(1, v));
        if (this._audio) this._audio.volume = this._volume;
    }

    /** Muta/desmuta. */
    mute() {
        this._muted = true;
        this.stop();
    }

    unmute() {
        this._muted = false;
    }

    get isMuted() { return this._muted; }
}

export const AudioNarrator = new AudioNarratorClass();
