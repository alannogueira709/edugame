// Phases.js
import { GamePhase } from './GamePhase.js';
import { Text } from './libs/letters.js';
import { fisherYatesShuffle, selectRandomElement, checkCollision, generateDistributedPositions } from './utils.js';

export class GamePhase1 extends GamePhase {
    constructor() {
        super('Game Phase', 1);
        
        // Entrada de palavra
        this.inputField = null;
        this.submitButton = null;
        this.gameStarted = false;
        
        // Estado do jogo
        this.currentWord = '';
        this.letters = [];
        this.letterPositions = [];
        this.letterColliders = [];
        this.correctLetterIndex = -1;
        this.correctLetter = '';
        
        // Player e Sprite
        this.playerSprite = null; 
        this.player = {
            x: 50,
            y: 50,
            w: 80,
            h: 80,
            vx: 0,
            vy: 0,
            speed: 5
        };
        
        // UI flags
        this.showVictoryScreen = false;
        this.showInputPhase = true;
    }

    initializePhase() {
        super.initializePhase();
        console.log('Fase Única: Digite uma palavra e acerte a letra correta!');
        
        // Carrega a sprite do player (certifique-se de ter assets/player.png)
        loadImage('assets/player.png', 
            (img) => {
                this.playerSprite = img;
                console.log('Sprite do player carregada!');
            },
            () => console.log('Sprite do player não encontrada, usando retângulo padrão.')
        );

        this.createInputControls();
    }

    createInputControls() {
        this.inputField = createInput();
        this.inputField.attribute('placeholder', 'Digite uma palavra...');
        this.inputField.position(windowWidth / 2 - 125, windowHeight - 150);
        this.inputField.size(250);
        this.elements.push(this.inputField);

        this.submitButton = createButton('Começar!');
        this.submitButton.position(windowWidth / 2 + 135, windowHeight - 150);
        this.submitButton.mousePressed(() => this.onWordSubmit());
        
        // Adiciona suporte ao Enter
        this.inputField.elt.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && this.inputField.value().trim().length > 0) {
                this.onWordSubmit();
            }
        });
        
        this.elements.push(this.submitButton);
    }

    async onWordSubmit() {
        const userWord = this.inputField.value().trim().toUpperCase();
        
        if (userWord.length < 2) {
            alert('Digite uma palavra com pelo menos 2 letras!');
            return;
        }

        this.currentWord = userWord;
        this.letters = userWord.split('');
        
        const shuffledLetters = fisherYatesShuffle(this.letters);
        
        this.correctLetter = selectRandomElement(this.letters);
        this.correctLetterIndex = this.letters.indexOf(this.correctLetter);
        
        console.log(`Palavra: ${this.currentWord}, Alvo: ${this.correctLetter}`);
        
        await this.loadLetterImages(shuffledLetters);
        
        this.generateLetterPositions();
        
        this.inputField.style('display', 'none');
        this.submitButton.style('display', 'none');
        this.showInputPhase = false;
        this.gameStarted = true;
    }

    async loadLetterImages(letterArray) {
        this.letterImages = [];
        
        for (const letter of letterArray) {
            const textInstance = new Text(letter);
            const lettersObjects = await textInstance.loadAllImages();
            
            if (lettersObjects.length > 0) {
                this.letterImages.push({
                    letter: letter,
                    image: lettersObjects[0].image 
                });
            }
        }
    }

    generateLetterPositions() {
        const count = this.letterImages.length;
        // height - 200 evita que letras apareçam muito embaixo (na UI)
        const positions = generateDistributedPositions(count, width, height - 200);
        
        this.letterPositions = positions;
        
        this.letterColliders = positions.map((pos, index) => ({
            x: pos.x,
            y: pos.y,
            w: 60,
            h: 60,
            letter: this.letterImages[index].letter,
            isCorrect: this.letterImages[index].letter === this.correctLetter
        }));
    }

    updateGame() {
        if (!this.gameStarted || this.isPaused) return;

        this.player.vx = 0;
        this.player.vy = 0;

        // Controles
        if (keyIsDown(LEFT_ARROW) || keyIsDown(65)) this.player.vx = -this.player.speed;
        if (keyIsDown(RIGHT_ARROW) || keyIsDown(68)) this.player.vx = this.player.speed;
        if (keyIsDown(UP_ARROW) || keyIsDown(87)) this.player.vy = -this.player.speed;
        if (keyIsDown(DOWN_ARROW) || keyIsDown(83)) this.player.vy = this.player.speed;

        this.player.x += this.player.vx;
        this.player.y += this.player.vy;

        this.player.x = constrain(this.player.x, 0, width - this.player.w);
        this.player.y = constrain(this.player.y, 0, height - this.player.h);

        this.checkLetterCollisions();
    }

    checkLetterCollisions() {
        const playerRect = {
            x: this.player.x,
            y: this.player.y,
            w: this.player.w,
            h: this.player.h
        };

        for (const collider of this.letterColliders) {
            if (checkCollision(playerRect, collider)) {
                if (collider.isCorrect) {
                    this.winRound();
                } else {
                    this.loseLife();
                    const index = this.letterColliders.indexOf(collider);
                    this.letterColliders.splice(index, 1);
                }
                break;
            }
        }
    }

    winRound() {
        this.showVictoryScreen = true;
        this.gameStarted = false;
        this.addScore(100);
        setTimeout(() => {
            this.onPhaseComplete();
        }, 3000); // 3 segundos para ler a vitória
    }

    /**
     * MÉTODO DRAW ATUALIZADO COM HUD
     */
    draw() {
        if (!this.isActive || this.isPaused) return;

        background(46, 153, 191);

        if (this.showInputPhase) {
            // TELA DE INPUT
            fill(255);
            textAlign(CENTER);
            textSize(28);
            text('Digite uma palavra para começar', width / 2, 100);
            
            textSize(16);
            fill(200);
            text('Use WASD ou setas para mover', width / 2, height - 200);

        } else if (this.gameStarted) {
            // JOGO RODANDO
            this.updateGame();
            
            // 1. Letras
            this.drawLetters();
            
            // 2. Player
            this.drawPlayer(); 

            // 3. HUD - Aviso da Letra (Posição Ajustada)
            push(); 
            rectMode(CENTER);
            
            // Fundo preto transparente
            // Mudei o Y de 60 para 130
            fill(0, 0, 0, 150); 
            noStroke();
            rect(width / 2, 130, 450, 70, 15); 

            // Texto principal
            // Mudei o Y de 55 para 125
            textAlign(CENTER, CENTER);
            textSize(32); 
            fill(255, 215, 0); 
            textStyle(BOLD);
            text(`PEGUE A LETRA: "${this.correctLetter}"`, width / 2, 125);
            
            // Texto secundário
            // Mudei o Y de 85 para 155
            textSize(14);
            fill(255);
            textStyle(NORMAL);
            text('Use as setas para mover', width / 2, 155);
            
            pop(); 

        } else if (this.showVictoryScreen) {
            // TELA DE VITÓRIA
            fill(0, 0, 0, 200);
            rect(0, 0, width, height);
            
            fill(255, 200, 0);
            textAlign(CENTER);
            textSize(48);
            text('🎉 VITÓRIA! 🎉', width / 2, height / 2 - 20);
            
            fill(255);
            textSize(24);
            text(`Você encontrou a letra "${this.correctLetter}"!`, width / 2, height / 2 + 40);
        }

        this.updateUI();
        this.checkGameState();
    }
    drawLetters() {
        for (let i = 0; i < this.letterImages.length; i++) {
            const letterObj = this.letterImages[i];
            const collider = this.letterColliders[i];
            
            if (letterObj && letterObj.image && collider) {
                image(letterObj.image, collider.x, collider.y, collider.w, collider.h);
            }
        }
    }

    drawPlayer() {
        if (this.playerSprite) {
            image(this.playerSprite, this.player.x, this.player.y, this.player.w, this.player.h);
        } else {
            // Fallback (retângulo)
            fill(79, 195, 247);
            stroke(255);
            strokeWeight(2);
            rect(this.player.x, this.player.y, this.player.w, this.player.h, 5);
            noStroke();
            
            fill(255);
            textAlign(CENTER);
            textSize(12);
            text('VOCÊ', this.player.x + this.player.w / 2, this.player.y - 10);
        }
    }

    cleanup() {
        super.cleanup();
        if (this.inputField) {
            this.inputField.remove();
            this.inputField = null;
        }
        if (this.submitButton) {
            this.submitButton.remove();
            this.submitButton = null;
        }
    }

    handleResize() {
        if (this.inputField && this.showInputPhase) {
            this.inputField.position(windowWidth / 2 - 125, windowHeight - 150);
        }
        if (this.submitButton && this.showInputPhase) {
            this.submitButton.position(windowWidth / 2 + 135, windowHeight - 150);
        }
    }
}

export class Phase1 extends GamePhase1 {}
export class Phase2 extends GamePhase1 {}
export class Phase3 extends GamePhase1 {}