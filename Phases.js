// Phases.js
import { GamePhase } from './GamePhase.js';

export class Phase1 extends GamePhase {
    constructor() {
        super('Alfabetização - Nível 1', 1);
    }

    initializePhase() {
        // 1. Define as questões do roteiro
        this.questoes = [
            {
                id:           'q1',
                bncc:         'BNCC_PORT_01',
                enunciado:    'Qual letra faz o som de "SSS"?',
                bancoPalavras: ['SAPO', 'SELO', 'SINO', 'SUCO'],
                alternativas: [
                    { id: 'A', label: 'A' },
                    { id: 'S', label: 'S' },
                    { id: 'M', label: 'M' },
                ],
                correta: 'S',
            },
            {
                id:           'q2',
                bncc:         'BNCC_PORT_02',
                enunciado:    'Qual é a primeira letra de "BOLA"?',
                bancoPalavras: ['BOLA', 'BOTA', 'BALA', 'BICO'],
                alternativas: [
                    { id: 'A', label: 'A' },
                    { id: 'B', label: 'B' },
                    { id: 'O', label: 'O' },
                ],
                correta: 'B',
            },
        ];

        // 2. Carrega o sprite do robô e inicia o roteiro quando pronto
        loadImage(
            'assets/player.png',
            (img) => { this.playerSprite = img; this.iniciarRoteiro(); },
            ()    => { this.iniciarRoteiro(); } // sem sprite, usa fallback
        );
    }

    // Opcional: sobrescreve reproduzirMidia para tocar vídeos reais
    reproduzirMidia(tipo, textoFallback) {
        super.reproduzirMidia(tipo, textoFallback); // mantém o texto na tela

        // Aqui você vai conectar seus vídeos quando tiver os assets:
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
            {
                id:           'mat_q1',
                bncc:         'BNCC_MAT_02',
                enunciado:    'Quanto é 2 + 3?',
                alternativas: [
                    { id: 'op4', label: '4' },
                    { id: 'op5', label: '5' },
                    { id: 'op6', label: '6' },
                ],
                correta: 'op5',
            },
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
        this.questoes = [
            // questões mistas...
        ];
        loadImage('assets/player.png',
            img => { this.playerSprite = img; this.iniciarRoteiro(); },
            ()  => this.iniciarRoteiro()
        );
    }
}
