export class Text {
    constructor(textInput) {
        this.text = textInput;
        this.letters = [];
        this.text.split('').forEach(char => {
            const letter = new Letters(char, { assetDir: 'assets', extension: 'png' });
            this.letters.push(letter);
        });
    }

    async loadAllImages() {
        const loadPromises = this.letters.map(letter => letter.loadImage());
        await Promise.all(loadPromises);
        return this.letters;  
    }
}

export class Letters {
    constructor(char, options = {}) {
        const { assetDir = 'assets', extension = 'png', placeholder = true } = options;
        
        this.char = char;
        this.assetDir = assetDir;     
        this.extension = extension;
        this.placeholder = placeholder;
        this.imagePath = `${assetDir}/${char}_letter.${extension}`;
        this.image = null;
    }

    async loadImage() {
        try {
            // Tenta carregar a imagem do caractere
            this.image = await new Promise((resolve, reject) => {
                loadImage(
                    this.imagePath,
                    (img) => resolve(img),
                    () => reject(new Error(`Imagem não encontrada: ${this.imagePath}`))
                );
            });
        } catch (error) {
            console.warn(error.message);
            // Se a imagem não existir, cria um placeholder
            this.image = this._createPlaceholder(this.char);
        }
        
        return this.image;
    }

    _createPlaceholder(char) {
        if (!this.placeholder || typeof createGraphics !== 'function') return null;
        
        const g = createGraphics(96, 90);
        g.background(245);
        g.stroke(60);
        g.noFill();
        g.rect(0, 0, g.width, g.height);
        g.fill(30);
        g.textAlign(CENTER, CENTER);
        g.textSize(32);
        g.text(char, g.width / 2, g.height / 2);
        
        return g;
    }
}