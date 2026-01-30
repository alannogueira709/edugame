/**
 * utils.js - Funções utilitárias para o jogo
 */

/**
 * Algoritmo de Fisher-Yates para embaralhamento com distribuição uniforme
 * @param {Array} array - Array a ser embaralhado
 * @returns {Array} - Array embaralhado
 */
export function fisherYatesShuffle(array) {
    // Cria uma cópia para não modificar o original
    const shuffled = [...array];
    
    // Itera de trás para frente
    for (let i = shuffled.length - 1; i > 0; i--) {
        // Gera índice aleatório entre 0 e i (inclusive)
        const j = Math.floor(Math.random() * (i + 1));
        
        // Troca elementos
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    return shuffled;
}

/**
 * Seleciona um elemento aleatório de um array
 * @param {Array} array - Array para selecionar
 * @returns {*} - Elemento aleatório
 */
export function selectRandomElement(array) {
    return array[Math.floor(Math.random() * array.length)];
}

/**
 * Verifica colisão entre dois retângulos
 * @param {Object} rect1 - Retângulo 1 {x, y, w, h}
 * @param {Object} rect2 - Retângulo 2 {x, y, w, h}
 * @returns {Boolean} - true se há colisão
 */
export function checkCollision(rect1, rect2) {
    return rect1.x < rect2.x + rect2.w &&
           rect1.x + rect1.w > rect2.x &&
           rect1.y < rect2.y + rect2.h &&
           rect1.y + rect1.h > rect2.y;
}

/**
 * Gera posições aleatórias e distribuídas para as letras na tela
 * @param {Number} count - Número de posições
 * @param {Number} canvasWidth - Largura do canvas
 * @param {Number} canvasHeight - Altura do canvas
 * @returns {Array} - Array de posições {x, y}
 */
export function generateDistributedPositions(count, canvasWidth, canvasHeight) {
    const minSpacing = 120; // Espaçamento mínimo entre letras
    const letterSize = 60;
    const positions = [];
    const margin = 100;
    
    const maxX = canvasWidth - margin - letterSize;
    const maxY = canvasHeight - margin - letterSize;
    const minX = margin;
    const minY = margin;
    
    let attempts = 0;
    const maxAttempts = 1000;
    
    while (positions.length < count && attempts < maxAttempts) {
        const x = Math.random() * (maxX - minX) + minX;
        const y = Math.random() * (maxY - minY) + minY;
        
        // Verifica se está longe o suficiente de outras posições
        let isValid = true;
        for (const pos of positions) {
            const distance = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2);
            if (distance < minSpacing) {
                isValid = false;
                break;
            }
        }
        
        if (isValid) {
            positions.push({x, y});
        }
        
        attempts++;
    }
    
    return positions;
}
