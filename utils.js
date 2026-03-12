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

/**
 * Gera layout linear horizontal para letras de uma palavra em posição aleatória.
 * O espaçamento é adaptado ao tamanho da palavra e ao tamanho da tela.
 * @param {String} word - Palavra a ser distribuída
 * @param {Number} canvasWidth - Largura do canvas
 * @param {Number} canvasHeight - Altura do canvas
 * @returns {Object} - { letters: [{char, x, y, size}], spacing, lineY, totalWidth }
 */
/**
 * @param {Object} [opts]
 * @param {number} [opts.spriteZoneX]      - Limite X direito disponível (exclui área do sprite)
 * @param {Object} [opts.layoutContraints] - { topY, botY } — faixa vertical da zona de jogo
 */
export function generateLinearWordLayout(word, canvasWidth, canvasHeight, opts = {}) {
    const letters = String(word ?? '').trim().split('');
    if (!letters.length) {
        return { letters: [], spacing: 0, lineY: canvasHeight / 2, totalWidth: 0 };
    }

    const safeWidth  = Math.max(canvasWidth,  320);
    const safeHeight = Math.max(canvasHeight, 240);

    // Limite X direito: respeita a zona do sprite se informada
    const maxAvailableX = (opts.spriteZoneX != null && opts.spriteZoneX > 80)
        ? opts.spriteZoneX
        : safeWidth;

    const marginX       = Math.max(24, safeWidth * 0.06);
    const minLetterSize = Math.max(26, safeHeight * 0.05);
    const maxLetterSize = Math.min(86, safeHeight * 0.14);

    const availableW = maxAvailableX - marginX * 2;
    const sizeByWord = availableW / (letters.length * 1.7);
    const letterSize = Math.floor(Math.min(maxLetterSize, Math.max(minLetterSize, sizeByWord)));

    const spacing       = Math.max(8, letterSize * 0.22);
    const totalWidth    = letters.length * letterSize + (letters.length - 1) * spacing;
    const fitScale      = totalWidth > availableW ? (availableW / totalWidth) : 1;
    const finalLetterSize = letterSize * fitScale;
    const finalSpacing    = spacing   * fitScale;
    const finalTotalWidth = letters.length * finalLetterSize + (letters.length - 1) * finalSpacing;

    // X: centralizado horizontalmente na área disponível (sem aleatoriedade)
    const startX = marginX + Math.max(0, (availableW - finalTotalWidth) / 2);

    // Y: FIXO no centro da zona de jogo (sem aleatoriedade no eixo Y)
    const topY  = opts.layoutContraints?.topY  ?? Math.max(120, safeHeight * 0.22);
    const botY  = opts.layoutContraints?.botY  ?? Math.max(topY + 40, safeHeight - Math.max(180, safeHeight * 0.30));
    const lineY = topY + (botY - topY) / 2 - finalLetterSize / 2;

    const positionedLetters = letters.map((char, index) => ({
        char,
        x: startX + index * (finalLetterSize + finalSpacing),
        y: lineY,
        size: finalLetterSize,
    }));

    return {
        letters: positionedLetters,
        spacing: finalSpacing,
        lineY,
        totalWidth: finalTotalWidth,
    };
}