// Phases.js
import { GamePhase } from './GamePhase.js';
import { createQuestion } from './QuestionLog.js';

export class Phase1 extends GamePhase {
    constructor() {
        super('Alfabetização - Nível 1', 1);
    }

    initializePhase() {
        this.questoes = [
            createQuestion({
                id:           'q1',
                bncc:         'EF01LP03',
                enunciado:    'Qual letra faz o som de "SSS"?',
                bancoPalavras: ['SAPO', 'SELO', 'SINO', 'SUCO'],
                alternativas: [
                    { id: 'A', label: 'A' },
                    { id: 'S', label: 'S' },
                    { id: 'M', label: 'M' },
                ],
                correta: 'S',
            }),
            createQuestion({
                id:           'q2',
                bncc:         'EF01LP03',
                enunciado:    'Qual é a primeira letra de "BOLA"?',
                bancoPalavras: ['BOLA', 'BOTA', 'BALA', 'BICO'],
                alternativas: [
                    { id: 'A', label: 'A' },
                    { id: 'B', label: 'B' },
                    { id: 'O', label: 'O' },
                ],
                correta: 'B',
            }),
        ];

        loadImage(
            'assets/player.png',
            (img) => { this.playerSprite = img; this.iniciarRoteiro(); },
            ()    => { this.iniciarRoteiro(); }
        );
    }

    reproduzirMidia(tipo, textoFallback) {
        super.reproduzirMidia(tipo, textoFallback);
        // Conecte vídeos reais aqui quando tiver os assets:
        // const src = { reforcao_positivo: 'videos/parabens.mp4', ... }[tipo];
        // if (src) { videoPlayer.src = src; videoPlayer.play(); }
    }
}

export class Phase2 extends GamePhase {
    constructor() {
        super('Matemática - Adição', 2);
    }

    initializePhase() {
        this.questoes = [
            createQuestion({
                id:          'mat_q1',
                bncc:        'EF01MA06',
                enunciado:   'Quanto é 2 + 3?',
                alternativas: [
                    { id: 'op4', label: '4' },
                    { id: 'op5', label: '5' },
                    { id: 'op6', label: '6' },
                ],
                correta: 'op5',
            }),
        ];

        loadImage(
            'assets/player.png',
            (img) => { this.playerSprite = img; this.iniciarRoteiro(); },
            ()    => { this.iniciarRoteiro(); }
        );
    }
}

export class Phase3 extends GamePhase {
    constructor() {
        super('Diagnóstico Misto', 3);
    }

    initializePhase() {
        // TODO: adicione questões aqui usando createQuestion().
        // Enquanto o array estiver vazio, um aviso é exibido no
        // console e a fase encerra imediatamente sem travar o jogo.
        //
        // Exemplo mínimo:
        // this.questoes = [
        //     createQuestion({
        //         id: 'diag_01', bncc: 'EF01LP01',
        //         enunciado: 'Qual é a vogal?',
        //         alternativas: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        //         correta: 'a',
        //     }),
        // ];
        this.questoes = [];

        loadImage(
            'assets/player.png',
            (img) => { this.playerSprite = img; this.iniciarRoteiro(); },
            ()    => { this.iniciarRoteiro(); }
        );
    }
}