import { Text, Letters } from './libs/letters.js';

let inputField, button;
let textInstance = null;
let sprites = [];

window.setup = setup;
window.draw = draw;
window.windowResized = windowResized;

function setup() {
  console.log('setup() foi chamada!');
  createCanvas(windowWidth, windowHeight);

  inputField = createInput();
  inputField.attribute('placeholder', 'Digite algo...');
  inputField.position(windowWidth - 450, windowHeight - 500);

  button = createButton('ok!');
  button.position(windowWidth - 250, windowHeight - 500);
  button.mousePressed(async () => {
    const userText = inputField.value();
    
    if (userText.trim() === '') {
      console.warn('Digite algo!');
      return;
    }
    
    // Cria uma instância de Text com o texto digitado
    textInstance = new Text(userText);
    
    // Carrega as imagens de todas as letras
    sprites = await textInstance.loadAllImages();
    
    console.log(`Texto "${userText}" processado! ${sprites.length} letras carregadas.`);
  });
}

function draw() {
  background(46, 153, 191, 25);
  textAlign(CENTER);
  textSize(16);
  text(`x: ${mouseX} y: ${mouseY}`, 50, 50);

  // Desenha as imagens/caracteres carregados
  if (sprites.length > 0) {
    const startX = 40;
    const y = height / 2 - 32;
    
    sprites.forEach((letterObj, i) => {
      if (letterObj.image) {
        image(letterObj.image, startX + i * 72, y);
      }
    });
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  
  // Reposiciona os elementos
  const inputX = width - 450;
  const inputY = height - 500;
  inputField.position(inputX, inputY);
  button.position(inputX + 200, inputY);
}