// RobotSprite.js
// ============================================================
//  Sistema de animação do robô tutor do NeuroBeep.
//
//  Gerencia:
//    • Carregamento e troca de sprite sheets (idle/talking/right/wrong)
//    • Transições suaves entre animações com cross-fade
//    • Sequências encadeadas de animações
//    • Speech bubble no canvas p5.js
//    • Mapeamento semântico tipo → animação + cor de feedback
//
//  Depende de: p5.js globals (image, tint, millis, rect, text…)
//
//  USO:
//    const robot = new RobotSprite();
//    robot.setup();
//    // no draw():
//    robot.draw(x, y, w, h, feedbackMessage, feedbackColor);
//    // para mudar animação:
//    robot.playByTipo('reforcao_positivo');
// ============================================================

const SOURCES = {
    idling:  'assets/sprites/sprite_sheet_idle.png',
    talking: 'assets/sprites/sprite_sheet_talking.png',
    right:   'assets/sprites/sprite_sheet_right.png',
    wrong:   'assets/sprites/sprite_sheet_wrong.png',
};

const CONFIG = {
    fps:          15,
    columns:       5,
    rows:         20,
    transitionMs: 180,
};

// Mapeamento tipo de feedback → chave de animação
const TIPO_ANIMACAO = {
    reforcao_positivo:          'right',
    reforcao_persistencia:      'right',
    explicacao_conteudo:        'talking',
    incentivo:                  'talking',
    engajamento:                'talking',
    alerta_execucao:            'talking',
    orientacao_espacial:        'talking',
    compreensao:                'talking',
    scaffolding:                'wrong',
    erro_cognitivo_reincidente: 'wrong',
    resolucao:                  'wrong',
};

// Mapeamento tipo de feedback → cor RGB da speech bubble
const TIPO_COR = {
    reforcao_positivo:          [80,  220, 100],
    reforcao_persistencia:      [80,  220, 100],
    explicacao_conteudo:        [255, 215,   0],
    compreensao:                [255, 215,   0],
    incentivo:                  [255, 180,  50],
    scaffolding:                [255, 180,  50],
    engajamento:                [255, 180,  50],
    alerta_execucao:            [255,  80,  80],
    orientacao_espacial:        [255, 150,  50],
    resolucao:                  [200, 200, 255],
    erro_cognitivo_reincidente: [255, 120, 120],
};

export class RobotSprite {

    constructor() {
        /** @type {Record<string, AnimationState>} */
        this._sprites    = {};
        this._current    = null;
        this._currentKey = 'idling';
        this._previous   = null;
        this._transition = null;
        this._nonce      = 0;
    }

    // ──────────────────────────────────────────────────────────
    //  SETUP / DISPOSE
    // ──────────────────────────────────────────────────────────

    /** Carrega todos os sprite sheets. Chamar no setup() da cena. */
    setup() {
        for (const [key, src] of Object.entries(SOURCES)) {
            loadImage(src,
                (img) => {
                    this._sprites[key] = this._buildState(key, img);
                    if (!this._current && key === 'idling') this.play('idling');
                },
                () => console.warn(`[RobotSprite] Falha ao carregar: ${src}`)
            );
        }
    }

    /** Cancela todas as animações em curso. Chamar no cleanup() da cena. */
    dispose() {
        this._nonce++;
        for (const s of Object.values(this._sprites)) {
            s.isPlaying = false;
            s.onEnded   = null;
        }
        this._sprites    = {};
        this._current    = null;
        this._previous   = null;
        this._transition = null;
    }

    // ──────────────────────────────────────────────────────────
    //  CONTROLE DE ANIMAÇÃO
    // ──────────────────────────────────────────────────────────

    /**
     * Toca uma animação pelo nome da chave.
     * @param {string}         key
     * @param {Function|null}  [onEnded] - Callback chamado ao terminar (sem loop)
     * @returns {boolean} true se a animação foi iniciada
     */
    play(key, onEnded) {
        const anim = this._sprites[key];
        if (!anim?.frames?.length) return false;

        const prev = this._current && this._current !== anim
            ? { ...this._current }
            : null;

        for (const a of Object.values(this._sprites)) {
            a.isPlaying = false;
            a.onEnded   = null;
        }

        anim.frameIndex     = 0;
        anim.lastFrameAt    = millis();
        anim.isPlaying      = true;
        anim.onEnded        = onEnded ?? null;
        anim.loop           = typeof onEnded !== 'function' && key === 'idling';

        this._currentKey = key;
        this._current    = anim;
        this._previous   = prev;
        this._transition = prev ? { startedAt: millis() } : null;
        return true;
    }

    /**
     * Executa uma sequência de animações encadeadas.
     * Ao terminar a última, retorna para 'idling'.
     * @param {string[]} keys
     */
    playSequence(keys) {
        if (!keys?.length) return;
        this._nonce++;
        const nonce = this._nonce;
        let index   = 0;

        const next = () => {
            if (nonce !== this._nonce) return;
            const key = keys[index++];
            if (!key) return;
            const started = this.play(key, () => {
                index < keys.length ? next() : this.play('idling');
            });
            if (!started) {
                index < keys.length ? next() : this.play('idling');
            }
        };
        next();
    }

    /**
     * Seleciona e toca a animação correta para um tipo de feedback semântico.
     * @param {string} tipo - Chave semântica (ex: 'reforcao_positivo')
     */
    playByTipo(tipo) {
        this.playSequence([TIPO_ANIMACAO[tipo] ?? 'talking']);
    }

    /**
     * Retorna o array RGB de cor associado ao tipo de feedback.
     * @param {string} tipo
     * @returns {[number, number, number]}
     */
    colorForTipo(tipo) {
        return TIPO_COR[tipo] ?? [255, 255, 255];
    }

    // ──────────────────────────────────────────────────────────
    //  RENDERIZAÇÃO (p5.js)
    // ──────────────────────────────────────────────────────────

    /**
     * Desenha o sprite do robô no canvas p5.js.
     * Deve ser chamado dentro do draw() da cena.
     *
     * @param {number}   x
     * @param {number}   y
     * @param {number}   w
     * @param {number}   h
     * @param {string}   [feedbackMsg]   - LEGADO: removido da UI
     * @param {number[]} [feedbackColor] - LEGADO: removido da UI
     */
    draw(x, y, w, h, feedbackMsg = '', feedbackColor = [255, 255, 255]) {
        // Fundo levemente escurecido atrás do sprite
        push();
        fill(8, 20, 28, 50);
        noStroke();
        rect(x - 8, y - 8, w + 16, h + 16, 14);
        pop();

        // Speech bubble removido — texto do robo entregue via audio

        if (!this._current?.image) return;
        this._updateAnimation();

        const frame = this._currentFrame();
        if (!frame) return;
        const alpha = this._transitionAlpha();

        push();
        if (this._previous?.image && alpha < 1) {
            const prevFrame = this._frameOf(this._previous);
            if (prevFrame) {
                tint(255, (1 - alpha) * 255);
                image(this._previous.image, x, y, w, h, prevFrame.sx, prevFrame.sy, prevFrame.sw, prevFrame.sh);
            }
        }
        tint(255, alpha * 255);
        image(this._current.image, x, y, w, h, frame.sx, frame.sy, frame.sw, frame.sh);
        noTint();
        pop();
    }

    // ──────────────────────────────────────────────────────────
    //  PRIVADOS — animação
    // ──────────────────────────────────────────────────────────

    _buildState(key, img) {
        const fw = Math.floor(img.width  / CONFIG.columns);
        const fh = Math.floor(img.height / CONFIG.rows);
        const frames = [];

        for (let row = 0; row < CONFIG.rows; row++) {
            for (let col = 0; col < CONFIG.columns; col++) {
                frames.push({ sx: col * fw, sy: row * fh, sw: fw, sh: fh });
            }
        }

        return {
            key, image: img, frames,
            frameIndex: 0, lastFrameAt: 0,
            frameDurationMs: 1000 / CONFIG.fps,
            loop: false, isPlaying: false, onEnded: null,
        };
    }

    _updateAnimation() {
        const anim = this._current;
        if (!anim?.isPlaying) return;

        const now = millis();
        if (now - anim.lastFrameAt < anim.frameDurationMs) return;

        const elapsed = Math.max(1, Math.floor((now - anim.lastFrameAt) / anim.frameDurationMs));
        anim.lastFrameAt = now;

        for (let i = 0; i < elapsed; i++) {
            if (anim.frameIndex < anim.frames.length - 1) { anim.frameIndex++; continue; }
            if (anim.loop) { anim.frameIndex = 0; continue; }
            anim.isPlaying = false;
            const cb = anim.onEnded;
            anim.onEnded = null;
            if (typeof cb === 'function') cb();
            break;
        }
    }

    _currentFrame()  {
        if (!this._current?.frames?.length) return null;
        return this._current.frames[this._current.frameIndex] ?? this._current.frames[0];
    }

    _frameOf(anim) {
        if (!anim?.frames?.length) return null;
        return anim.frames[anim.frameIndex] ?? anim.frames[0];
    }

    _transitionAlpha() {
        if (!this._transition) return 1;
        const alpha = constrain((millis() - this._transition.startedAt) / CONFIG.transitionMs, 0, 1);
        if (alpha >= 1) { this._transition = null; this._previous = null; }
        return alpha;
    }

    // ──────────────────────────────────────────────────────────
    //  PRIVADOS — speech bubble REMOVIDO (texto via audio)
    // ──────────────────────────────────────────────────────────
}

/**
 * @typedef {{ key: string, image: object, frames: object[], frameIndex: number,
 *             lastFrameAt: number, frameDurationMs: number,
 *             loop: boolean, isPlaying: boolean, onEnded: Function|null }} AnimationState
 */