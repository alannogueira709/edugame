# NeuroBeep — Arquitetura do Jogo

> Documentação técnica da camada de jogo (`src/game/`).  
> Descreve a estrutura dos arquivos, o fluxo de dados e como criar novas fases.

---

## Índice

1. [Visão geral](#1-visão-geral)
2. [Estrutura de arquivos](#2-estrutura-de-arquivos)
3. [Mapa de dependências](#3-mapa-de-dependências)
4. [GameBridge — comunicação com hardware](#4-gamebridge--comunicação-com-hardware)
5. [QuestionLog — dados pedagógicos](#5-questionlog--dados-pedagógicos)
6. [RobotSprite — animação do robô tutor](#6-robotsprite--animação-do-robô-tutor)
7. [GameUI — interface HTML](#7-gameui--interface-html)
8. [GamePhase — orquestrador da fase](#8-gamephase--orquestrador-da-fase)
9. [Criando uma nova fase](#9-criando-uma-nova-fase)
10. [O objeto Questao](#10-o-objeto-questao)
11. [Fluxo pedagógico completo](#11-fluxo-pedagógico-completo)
12. [Histórico de refatorações](#12-histórico-de-refatorações)

---

## 1. Visão geral

O NeuroBeep é um jogo educativo que usa um **carrinho físico controlado por BLE** (Bluetooth Low Energy) como interface de entrada. O aluno "freia" o carrinho mentalmente com um sensor HEG, parando-o na alternativa correta.

A camada de jogo foi dividida em **cinco responsabilidades independentes**, cada uma em seu próprio arquivo:

| Arquivo | Responsabilidade |
|---|---|
| `GameBridge.js` | Toda comunicação externa (Tauri, BLE, Rust, Dashboard) |
| `QuestionLog.js` | Dados pedagógicos, constantes de estado e log de jogada |
| `RobotSprite.js` | Animação do robô tutor e speech bubble no canvas |
| `GameUI.js` | Criação e atualização de toda a interface HTML da fase |
| `GamePhase.js` | Orquestrador: máquina de estados, movimento, delegação |

> **Princípio central:** o `GamePhase` não conhece Tauri, DOM ou sprite sheets.  
> Ele delega para seus colaboradores e coordena o fluxo pedagógico.

---

## 2. Estrutura de arquivos

```
src/game/
├── GameBridge.js       ← comunicação com hardware e dashboard
├── GamePhase.js        ← orquestrador da fase (estenda este)
├── GameUI.js           ← toda a UI HTML da fase
├── QuestionLog.js      ← log pedagógico + STATUS_RESPOSTA + PHASE_STATE
├── RobotSprite.js      ← animação do robô tutor
│
├── Scene.js            ← classe base de todas as cenas
├── GameManager.js      ← gerencia cenas e fluxo entre elas
├── LandingPage.js      ← tela inicial
├── Phases.js           ← fases concretas (Phase1, Phase2, Phase3…)
│
├── utils.js            ← helpers sem dependência de jogo
├── sketch.js           ← ponto de entrada p5.js + ponte Tauri
│
├── styles.css          ← estilos da landing page
└── game-styles.css     ← estilos da fase de jogo (HUD, modal, zonas)
```

---

## 3. Mapa de dependências

```
sketch.js
  └── GameManager
        ├── LandingPage  (extends Scene)
        └── Phase1 / Phase2 / ...  (extends GamePhase)
                  │
                  ├── GameBridge     (comunica com Tauri/Rust/BLE)
                  ├── GameUI         (cria e atualiza o DOM)
                  ├── RobotSprite    (desenha no canvas p5.js)
                  └── QuestionLog    (registra cada jogada)
```

Nenhum dos colaboradores (`GameBridge`, `GameUI`, `RobotSprite`, `QuestionLog`) importa outro. Só o `GamePhase` conhece todos eles.

---

## 4. GameBridge — comunicação com hardware

**Arquivo:** `GameBridge.js`  
**Instanciado por:** `GamePhase` (um bridge por fase)

### O que faz

Encapsula **toda** a comunicação com o mundo externo. O restante do jogo não faz nenhuma chamada a `window.__TAURI__`, `window.__TAURI__.event.emit` ou `invoke` diretamente.

### Inicialização

```js
this.bridge = new GameBridge({ enableBleDebugHud: false });
await this.bridge.init(); // carrega config do trilho + registra listeners Tauri
```

O `init()` faz duas coisas assíncronas:
1. Chama `load_twin_config` no Rust para obter as margens e o total de passos do trilho físico.
2. Registra os três listeners Tauri (`telemetry-data`, `twin_heg_stop`, `twin_heg_resume`).

### Ouvindo o hardware

```js
// Telemetria BLE — chamado a cada pacote do carrinho
const off = this.bridge.onTelemetry(({ steps, velMedia, odomX }) => {
    this.player.x = this.bridge.stepsToPixelX(steps, width, this.player.w);
});

// Sinal HEG — concentração detectada → freia
const offStop = this.bridge.onHegStop(() => {
    this.movementControl.isMoving = false;
    this._resolverParadaPorProximidade();
});

// Sinal HEG — relaxamento → continua
const offResume = this.bridge.onHegResume(() => {
    this.ui.hideResultModal();
});

// Para remover um listener:
off();
```

### Controlando o carrinho físico

```js
this.bridge.sendCommand('VEL:0 0');          // para imediatamente
this.bridge.sendCommand('FOLLOW_LINE_START'); // inicia modo linha
this.bridge.sendCommand('VEL:200 200');       // velocidade manual
```

### Conversão passos ↔ pixels

O bridge faz a conversão bidirecional usando a config do trilho carregada do Rust:

```js
// Passos reais do encoder → posição X no canvas
const pixelX = this.bridge.stepsToPixelX(steps, width, player.w);

// Centro de uma zona em pixels → step alvo para o carrinho físico
const stepAlvo = this.bridge.pixelXToSteps(zona.x + zona.w / 2, width, player.w);
```

### Sincronizando o Dashboard

```js
this.bridge.syncPosition({ x, normalizedX, robotPosition });
this.bridge.syncQuestion({ tituloQuestao, opcoes, questionIndex });
this.bridge.syncState({ sessionState: 'ESPERA_ATIVA', activeTimer: 45 });
this.bridge.updateZones(questaoId, width, height, zonas);
```

### Dados pedagógicos

```js
this.bridge.registrarJogada(log.toPayload()); // persiste no Rust
this.bridge.exportarSessao();                 // salva JSON em disco
```

### Miniatura do Dashboard

```js
// No draw() da fase — envia 1 frame a cada 4 (throttle configurável)
this.bridge.sendFrameTick();
```

### Limpeza

```js
// No cleanup() da fase — remove todos os listeners de uma vez
this.bridge.dispose();
```

### Constantes exportadas

```js
import { TAURI_EVENTS, RUST_COMMANDS, DEFAULT_BT_CONFIG } from './GameBridge.js';

TAURI_EVENTS.TELEMETRY_DATA   // 'telemetry-data'
TAURI_EVENTS.TWIN_HEG_STOP    // 'twin_heg_stop'
RUST_COMMANDS.SEND_COMMAND    // 'send_command'
RUST_COMMANDS.REGISTRAR_JOGADA // 'registrar_jogada'
```

---

## 5. QuestionLog — dados pedagógicos

**Arquivo:** `QuestionLog.js`  
**Instanciado por:** `GamePhase` — um log por questão

### O que exporta

```js
export { STATUS_RESPOSTA, PHASE_STATE, QuestionLog }
```

### STATUS_RESPOSTA

Códigos numéricos que classificam o resultado de cada jogada:

| Código | Constante | Situação |
|---|---|---|
| 1 | `ACERTO_CONSOLIDADO` | Acertou de 1ª e confirmou que sabia |
| 2 | `ACERTO_ASSISTIDO` | Acertou na 2ª tentativa após dica |
| 3 | `ACERTO_CASUAL` | Acertou de 1ª, mas disse que chutou |
| 4 | `ERRO_COGNITIVO` | Errou nas duas tentativas |
| 5 | `OMISSAO_TIMEOUT` | Tempo esgotado sem interação |
| 6 | `ERRO_EXECUCAO` | Moveu mas não parou a tempo |
| 7 | `ERRO_ESPACIAL` | Parou entre as alternativas |

### PHASE_STATE

Estados da máquina de estados da fase:

```
idle → apresentacao → espera_ativa → decisao_1 → compreensao → encerramento
                                  ↘ feedback_erro → espera_2 → decisao_2 → feedback_final → encerramento
```

### Ciclo de vida do QuestionLog

```js
// 1. Criado no início de cada questão
const log = new QuestionLog(sessaoId, faseAtual, questaoId, bncc, gabaritoId);

// 2. Marcações ao longo da jogada
log.marcarExibicao();
log.registrarMovimento(isMoving, passos);
log.registrarRespostaEscolhida(1, zonaId);
log.registrarDicaOferecida();
log.registrarAlvoEsperado(passoMin, passoMax);

// 3. Finalização
log.finalizarJogada(STATUS_RESPOSTA.ACERTO_CONSOLIDADO, zonaId, passoFinal, true);
log.marcarInicioFeedback();
log.marcarFimFeedback();

// 4. Serialização para envio ao Rust
const payload = log.toPayload();
bridge.registrarJogada(payload);
```

### Estrutura do payload serializado

```json
{
  "sessao_id": "SESSAO_001",
  "fase_atual": 1,
  "contexto_pedagogico": {
    "id_questao": "q1",
    "habilidade_bncc": "EF01LP03",
    "gabarito_zona": "S",
    "dica_oferecida": false
  },
  "cronometria_sincronizada": {
    "t_exibicao_pergunta": 1711234567890,
    "t_primeiro_movimento": 1711234570000,
    "t_parada_final": 1711234572500,
    "t_inicio_feedback": 1711234572500,
    "t_fim_feedback": 1711234575700
  },
  "dinamica_neuro_motora": {
    "tempo_latencia_ms": 2110,
    "quedas_de_foco_qty": 0
  },
  "precisao_odometrica": {
    "posicao_inicial_passos": 80,
    "posicao_final_passos": 1420,
    "alvo_esperado_passos_min": 1300,
    "alvo_esperado_passos_max": 1600,
    "distancia_erro_passos": 0,
    "micro_hesitacoes": 0
  },
  "resolucao_final": {
    "zona_parada": "S",
    "status_resposta_cod": 1,
    "status_resposta_desc": "Acerto Consolidado",
    "verificacao_compreensao": true,
    "resposta_escolhida_1": "S",
    "resposta_escolhida_2": null,
    "tentativas": 1
  }
}
```

---

## 6. RobotSprite — animação do robô tutor

**Arquivo:** `RobotSprite.js`  
**Instanciado por:** `GamePhase`

### O que faz

Carrega e exibe o robô tutor animado no canvas p5.js, incluindo a speech bubble com o texto de feedback. Toda a lógica de animação — troca de sprite sheet, cross-fade entre animações e sequências encadeadas — fica encapsulada aqui.

### Sprite sheets disponíveis

| Chave | Arquivo | Quando usar |
|---|---|---|
| `idling` | `sprite_sheet_idle.png` | Estado padrão (loop) |
| `talking` | `sprite_sheet_talking.png` | Explicações e incentivos |
| `right` | `sprite_sheet_right.png` | Acertos e reforço positivo |
| `wrong` | `sprite_sheet_wrong.png` | Erros e scaffolding |

### Uso

```js
const robot = new RobotSprite();

// No setup() da cena
robot.setup(); // carrega as imagens com loadImage()

// No draw() — dentro do loop p5.js
const zone = this._getSpriteZone();
robot.draw(zone.x, zone.y, zone.w, zone.h, feedbackMessage, feedbackColor);

// Para tocar uma animação diretamente
robot.play('right', () => console.log('terminou'));

// Para tocar a animação correta para um tipo de feedback semântico
robot.playByTipo('reforcao_positivo'); // → toca 'right'
robot.playByTipo('scaffolding');       // → toca 'wrong'
robot.playByTipo('incentivo');         // → toca 'talking'

// Para obter a cor da speech bubble de um tipo de feedback
const cor = robot.colorForTipo('reforcao_positivo'); // → [80, 220, 100]

// No cleanup()
robot.dispose();
```

### Mapeamento tipo → animação

| Tipo semântico | Animação | Cor da bubble |
|---|---|---|
| `reforcao_positivo` | right | 🟢 Verde |
| `reforcao_persistencia` | right | 🟢 Verde |
| `explicacao_conteudo` | talking | 🟡 Amarelo |
| `compreensao` | talking | 🟡 Amarelo |
| `incentivo` | talking | 🟠 Laranja |
| `scaffolding` | wrong | 🟠 Laranja |
| `engajamento` | talking | 🟠 Laranja |
| `alerta_execucao` | talking | 🔴 Vermelho |
| `orientacao_espacial` | talking | 🟠 Laranja escuro |
| `resolucao` | wrong | 🔵 Lilás |
| `erro_cognitivo_reincidente` | wrong | 🔴 Rosa |

---

## 7. GameUI — interface HTML

**Arquivo:** `GameUI.js`  
**Instanciado por:** `GamePhase`

### O que faz

Cria e gerencia **todos os elementos DOM** da fase: HUD, challenge card com tiles da palavra, botões de zona, barra de status e o modal de resultado com confetti. Não conhece p5.js, lógica de jogo ou hardware.

### Ciclo de vida

```js
const ui = new GameUI(phaseNumber);

// No setup()
ui.mount(); // injeta os elementos no body

// No draw() — atualiza a HUD completa de uma vez
ui.update({
    score:          this.score,
    lives:          this.lives,
    questaoIndex:   this.questaoAtualIndex,
    totalQuestoes:  this.questoes.length,
    state:          this.state,
    timerIncentivo: this.timerIncentivo,
    showTimer:      this.showTimerBadge,
});

// Ao trocar de questão
ui.updateChallengeCard(enunciado, palavra);

// Ao gerar zonas (ou mudar de estado)
ui.updateZones(alternativas, state, correctaId);

// Ao parar o carrinho
ui.showResultModal(isCorrect, {
    correctLabel, selectedLabel, selectedDistance,
    alternativas, zones, playerAnchorX,
});

// No cleanup()
ui.unmount(); // remove todos os elementos do body
```

### Elementos criados por `mount()`

```
div.game-ui
  ├── .game-top-shell
  │     ├── .hud-pill-score   (#score-value)
  │     ├── .hud-pill-phase   (#phase-value)
  │     ├── .hud-pill-lives   (#lives-track)
  │     └── .timer-shell      (#timer-shell)
  ├── .game-challenge-card    (#challenge-card)
  │     ├── .game-enunciado   (#enunciado-text)
  │     └── .game-word-tiles  (#word-tiles)
  ├── .game-zonas-html         (#zonas-html)
  └── .game-statusbar
        ├── .status-copy      (#status-message)
        └── .status-chip      (#question-progress)

div.result-modal-backdrop (separado do game-ui)
  └── .result-modal-card
        ├── .result-modal-bar
        ├── .result-status-banner
        ├── .result-info-block
        ├── .result-distances-grid
        └── button.result-cta-btn
```

---

## 8. GamePhase — orquestrador da fase

**Arquivo:** `GamePhase.js`  
**Estendido por:** `Phase1`, `Phase2`, `Phase3`… em `Phases.js`

### Responsabilidades

- Ciclo de vida da cena p5.js (`setup / draw / cleanup`)
- Máquina de estados pedagógica (7 etapas)
- Física do player em dois modos: teclado e BLE
- Geração de zonas invisíveis de hit-testing
- Delegação aos colaboradores (`bridge`, `ui`, `robot`)

### Colaboradores instanciados automaticamente

```js
// Disponíveis em qualquer subclasse como this.bridge, this.ui, this.robot
this.bridge = new GameBridge();
this.ui     = new GameUI(phaseNumber);
this.robot  = new RobotSprite();
```

### Controles de teclado (modo simulação)

| Tecla | Ação |
|---|---|
| `ESPAÇO` | Para/move o carrinho (simula sinal HEG) |
| `← →` | Muda direção do movimento |
| `ESC` | Pausa / retoma |

### Callbacks para subclasses

```js
// Chamado pelo GameManager ao completar todas as questões
onPhaseComplete(payload) { ... }

// Chamado quando lives <= 0
onGameOver() { ... }
```

### Métodos úteis em subclasses

```js
// Reproduz áudio da questão (override com TTS real)
reproduzirAudioQuestao(questao) { ... }

// Reproduz mídia de feedback (override com vídeo/áudio real)
reproduzirMidia(tipo, textoFallback) { ... }

// Ponteiros rápidos para as constantes
this.STATUS.ACERTO_CONSOLIDADO  // → 1
this.ESTADOS.ESPERA_ATIVA       // → 'espera_ativa'
```

---

## 9. Criando uma nova fase

Crie uma classe em `Phases.js` que estende `GamePhase`. Você só precisa implementar `initializePhase()`:

```js
import { GamePhase } from './GamePhase.js';

export class PhasePortugues extends GamePhase {

    constructor() {
        super('Português — Sílabas', 4);
    }

    initializePhase() {
        // 1. Define as questões (ver seção 10 para o formato completo)
        this.questoes = [
            {
                id:           'sil_01',
                bncc:         'EF01LP03',
                enunciado:    'Qual sílaba começa a palavra "BOLA"?',
                bancoPalavras: ['BOLA', 'BOLO', 'BOLA'],
                alternativas: [
                    { id: 'bo', label: 'BO' },
                    { id: 'la', label: 'LA' },
                    { id: 'ol', label: 'OL' },
                ],
                correta: 'bo',
            },
        ];

        // 2. Carrega o sprite e inicia o roteiro
        loadImage(
            'assets/player.png',
            (img) => { this.playerSprite = img; this.iniciarRoteiro(); },
            ()    => { this.iniciarRoteiro(); }  // fallback sem sprite
        );
    }

    // Opcional: conecte vídeos reais aqui
    reproduzirMidia(tipo, textoFallback) {
        super.reproduzirMidia(tipo, textoFallback); // atualiza speech bubble

        const videos = {
            reforcao_positivo:   'videos/parabens.mp4',
            scaffolding:         'videos/dica_silabas.mp4',
        };
        const src = videos[tipo];
        if (src) { /* videoPlayer.src = src; videoPlayer.play(); */ }
    }
}
```

Em seguida, registre a fase no `sketch.js`:

```js
gameManager.addScene('phase4', new PhasePortugues());
```

---

## 10. O objeto Questao

Este é o contrato central do jogo. Todo o sistema (zonas, log, challenge card, sincronização com dashboard) é gerado a partir deste objeto.

```js
/**
 * @typedef {Object} Questao
 *
 * @property {string}        id           - Identificador único (ex: 'q1', 'mat_03')
 * @property {string}        bncc         - Código da habilidade BNCC (ex: 'EF01LP03')
 * @property {string}        enunciado    - Texto da pergunta exibido ao aluno
 * @property {Alternativa[]} alternativas - Lista de 2–4 alternativas de resposta
 * @property {string}        correta      - id da alternativa correta
 * @property {string[]}      [bancoPalavras] - Pool: uma palavra é sorteada a cada questão
 * @property {string}        [palavra]    - Palavra fixa (quando bancoPalavras está vazio)
 */

/**
 * @typedef {Object} Alternativa
 * @property {string} id    - Chave única na questão (ex: 'A', 'op1', 'sim')
 * @property {string} label - Texto exibido no botão (ex: 'S', '5', 'Sim')
 */
```

### Exemplo completo

```js
{
    id:           'q1',
    bncc:         'EF01LP04',
    enunciado:    'Qual letra faz o som de "SSS"?',
    bancoPalavras: ['SAPO', 'SELO', 'SINO', 'SUCO'],
    alternativas: [
        { id: 'A', label: 'A' },
        { id: 'S', label: 'S' },
        { id: 'M', label: 'M' },
    ],
    correta: 'S',
}
```

O campo `correta` deve ser o `id` de uma das alternativas (não o `label`).

---

## 11. Fluxo pedagógico completo

Cada questão passa por até 7 etapas. A máquina de estados garante que cada transição só acontece no momento certo.

```
┌─────────────────────────────────────────────────────────────────┐
│  APRESENTAÇÃO                                                   │
│  Exibe enunciado, word tiles e zonas. Inicia watchdog (15s).   │
└──────────────────────┬──────────────────────────────────────────┘
                       │
               ┌───────▼────────┐
               │  ESPERA ATIVA  │  ← aluno deve mover o carrinho
               └───────┬────────┘
          timeout 15s  │  carrinho para
               ┌───────▼───────────────┐
               │  ESPERA INCENTIVO     │  ← robô fala, timer começa (60s)
               └───────┬───────────────┘
                       │ carrinho para
               ┌───────▼───────────────┐
               │  DECISÃO 1            │  ← verifica zona de parada
               └──────┬────────────────┘
            acerto    │         erro
         ┌────────────┘         └──────────────┐
         ▼                                     ▼
  ┌─────────────┐                    ┌─────────────────┐
  │ COMPREENSÃO │                    │  FEEDBACK ERRO  │
  │ "Sabia ou   │                    │  Robô dá dica   │
  │  foi chute?"│                    │  (4s)           │
  └──────┬──────┘                    └────────┬────────┘
         │                                    │
         ▼                           ┌────────▼────────┐
  ┌─────────────────┐                │   ESPERA 2      │
  │ ENCERRAMENTO    │                └────────┬────────┘
  │ (3s) → próxima │                         │ carrinho para
  └─────────────────┘                ┌────────▼────────┐
                                     │   DECISÃO 2     │
                                     └──────┬──────────┘
                                  acerto    │    erro
                               ┌───────────┘    └──────────────┐
                               ▼                               ▼
                       ┌─────────────────┐          ┌─────────────────┐
                       │  ENCERRAMENTO   │          │ FEEDBACK FINAL  │
                       └─────────────────┘          │ Robô demonstra  │
                                                    │ resposta (5s)   │
                                                    └────────┬────────┘
                                                             ▼
                                                    ┌─────────────────┐
                                                    │  ENCERRAMENTO   │
                                                    └─────────────────┘
```

### Pontuação por resultado

| Resultado | Pontos |
|---|---|
| Acerto Consolidado (sabia) | +150 |
| Acerto Casual (chutou) | +100 |
| Acerto Assistido (2ª tentativa) | +50 |
| Erro nas duas tentativas | 0 |
| Timeout | 0 |

---

## 12. Histórico de refatorações

### Versão 2 — Separação em módulos (atual)

O `GamePhase.js` original tinha ~2.285 linhas com quatro responsabilidades misturadas. A refatoração dividiu em:

| Arquivo | Linhas | O que saiu do GamePhase original |
|---|---|---|
| `GameBridge.js` | ~370 | Toda comunicação Tauri/BLE/Rust — `tauriEmit`, listeners de `telemetry-data`, `twin_heg_stop`, `twin_heg_resume`, `_sincronizarPlayerComRobo`, BLE debug HUD |
| `QuestionLog.js` | ~193 | Classe `QuestionLog` e constantes `STATUS_RESPOSTA` + `PHASE_STATE` |
| `RobotSprite.js` | ~348 | `_setupRobotSprites`, `_createRobotAnimationState`, `_playRobotAnimation`, `_playRobotSequence`, `_drawSpeechBubble`, mapeamentos de cor e animação |
| `GameUI.js` | ~389 | `_criarGameUI`, `_atualizarUI`, `_atualizarChallengeCard`, `_atualizarZonasHtml`, `_showResultModal`, `_hideResultModal`, `_renderLivesTrack` |
| `GamePhase.js` | ~793 | Apenas orquestração: máquina de estados, movimento, zonas e delegação |

**Total de linhas:** 2.285 → 2.093 distribuídas em 5 arquivos coesos.

### Principais mudanças de API

**Antes** — chamadas diretas a Tauri dentro do GamePhase:
```js
// Espalhado por todo o arquivo
if (window.__TAURI__?.event?.emit) {
    await window.__TAURI__.event.emit('neurobeep_sync', { ... });
}
window.__TAURI__.core.invoke('registrar_jogada', { payload });
window.__TAURI__.event.listen('telemetry-data', handler);
```

**Depois** — delegação ao bridge:
```js
this.bridge.syncState({ sessionState, activeTimer });
this.bridge.registrarJogada(payload);
this.bridge.onTelemetry(handler);
```

**Antes** — desenho de zonas e tiles no canvas com p5.js:
```js
// Renderização manual de letras, retângulos, tiles no canvas
fill(14, 55, 72, 230);
rect(tileX, tileY, tileW, tileH, 14);
text(letter.char, ...);
```

**Depois** — HTML puro gerado pelo `GameUI`:
```js
this._wordTiles.innerHTML = word.split('').map((char, i) =>
    `<span class="word-tile${i === 0 ? ' word-tile-focus' : ''}">${char}</span>`
).join('');
```

**Antes** — `_salvarLogEEnviarParaRust()` com lógica Tauri inline:
```js
_salvarLogEEnviarParaRust() {
    if (!this.logAtual || this.logAtual._payloadEnviado) return;
    const payload = this.logAtual.toPayload();
    this.logsSession.push(payload);
    this.logAtual._payloadEnviado = true;
    if (window.__TAURI__?.core?.invoke) {
        window.__TAURI__.core.invoke('registrar_jogada', { payload })...
    }
}
```

**Depois** — método limpo, sem referência a Tauri:
```js
_salvarLog() {
    if (!this.logAtual || this.logAtual._payloadEnviado) return;
    const payload = this.logAtual.toPayload();
    this.logsSession.push(payload);
    this.logAtual._payloadEnviado = true;
    this.bridge.registrarJogada(payload);
}
```

### Regra de ouro para novas alterações

> **Onde devo mexer se…**
>
> - Muda o protocolo BLE ou algum evento Tauri → `GameBridge.js`
> - Muda um campo do log pedagógico ou adiciona um novo status → `QuestionLog.js`
> - Muda a animação do robô ou adiciona um novo tipo de feedback → `RobotSprite.js`
> - Muda o layout visual do HUD, do modal ou dos botões → `GameUI.js` + `game-styles.css`
> - Muda o fluxo de uma tentativa, o timing dos estados ou a física do player → `GamePhase.js`
> - Adiciona uma nova fase com novas questões → `Phases.js` (só estende `GamePhase`)
