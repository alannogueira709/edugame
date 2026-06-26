// Phases.js
// Fases alinhadas com dublagem.yaml
import { GamePhase } from './GamePhase.js';
import { createQuestion } from './QuestionLog.js';

export class Phase1 extends GamePhase {
    constructor() {
        super('Alfabetizacao - Nivel 1', 1);
    }

    initializePhase() {
        this.questoes = [
            createQuestion({
                id:           'q1',
                bncc:         'EF01LP03',
                enunciado:    'Pare o robo na letra I na palavra AMIGO.',
                bancoPalavras: ['AMIGO'],
                alternativas: [
                    { id: 'A', label: 'A' },
                    { id: 'I', label: 'I' },
                    { id: 'O', label: 'O' },
                ],
                correta: 'I',
            }),
        ];

        loadImage(
            'assets/player.png',
            (img) => { this.playerSprite = img; this.iniciarRoteiro(); },
            ()    => { this.iniciarRoteiro(); }
        );
    }
}

export class Phase2 extends GamePhase {
    constructor() {
        super('Alfabetizacao - Nivel 2', 2);
    }

    initializePhase() {
        this.questoes = [
            createQuestion({
                id:           'q2',
                bncc:         'EF01LP03',
                enunciado:    'Pare o robo na palavra que comeca com G.',
                bancoPalavras: ['GATO'],
                alternativas: [
                    { id: 'Gato',    label: 'Gato' },
                    { id: 'Bola',    label: 'Bola' },
                    { id: 'Sapato',  label: 'Sapato' },
                    { id: 'Futebol', label: 'Futebol' },
                ],
                correta: 'Gato',
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
        super('Alfabetizacao - Nivel 3', 3);
    }

    initializePhase() {
        this.questoes = [
            createQuestion({
                id:           'q3',
                bncc:         'EF01LP03',
                enunciado:    'Pare o robo na letra que faz som de SSS em SAPO.',
                bancoPalavras: ['SAPO'],
                alternativas: [
                    { id: 'A', label: 'A' },
                    { id: 'S', label: 'S' },
                    { id: 'M', label: 'M' },
                ],
                correta: 'S',
            }),
        ];

        loadImage(
            'assets/player.png',
            (img) => { this.playerSprite = img; this.iniciarRoteiro(); },
            ()    => { this.iniciarRoteiro(); }
        );
    }
}
