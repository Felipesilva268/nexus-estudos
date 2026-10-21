# Documentação Técnica — Nexus Study App (v3.5)

## 1. Visão Geral & Arquitetura
- **Arquitetura Single-File SPA**: Aplicação web estruturada em arquivo único (`index.html`), empacotada nativamente para **Android** via **Capacitor** e compatível com instalação **PWA**.
- **Stack Front-End**: **HTML5**, **CSS3** customizado (identidade *Dark Club / Lavo*), **Bootstrap 5.3**, **Chart.js 4.4** (visualização de dados) e **Ace Editor 1.32** (edição de código e Markdown).
- **Execução Local de Código**: Integração com **Pyodide v0.25** (**WebAssembly**) para rodar scripts **Python 3** diretamente no navegador sem servidor externo.
- **Síntese de Áudio Procedural**: Uso da **Web Audio API** para geração matemática em tempo real de 5 canais independentes (**Ruído Marrom**, **Ruído Rosa**, **Ruído Branco**, **Chuva Suave** e **Synth Lo-Fi**).

## 2. Motor de Persistência Tripla
- **Camada 1 — `localStorage` (`NEXUS_STUDY_STATE_V1`)**: Persistência síncrona imediata no navegador ou **WebView** do Android para operação 100% offline.
- **Camada 2 — `File System Access API` + `IndexedDB`**: No desktop, grava automaticamente o estado completo no arquivo físico `meus_dados.json` dentro da pasta sincronizada com o **Google Drive**.
- **Camada 3 — `Firebase REST API` (`nexus_state.json`)**: Sincronização em nuvem entre PC e smartphone via requisições HTTP `PUT` (`pushStateToCloud`) e `GET` (`pullStateFromCloud`).
- **Normalização (`normalizeCloudData`)**: Reconstrói arrays vazios (`[]`) omitidos pelo **Firebase** ao receber dados da nuvem, prevenindo falhas de referência (`undefined`).

## 3. Dicionário de Dados (`appState` Schema)
- **`settings`**: Objeto de configurações globais contendo `dailyGoalMinutes` (meta diária), `focusMinutes` (ciclo Pomodoro), `waterGoalMl` (meta de água), `bonusXp`, `degreeTotalHours`, `degreeCompletedHours`, `ergo2020Enabled` e `gatekeeperEnabled`.
- **`subjects`**: Array de disciplinas no modelo **4 Unidades x 5 Aulas**, contendo `id`, `name`, `color`, `targetHours`, `minutesStudied`, `prompts` (`Array`), `formulas` (`Array`) e `units` (`Array` com `score` de `0` a `5`, `quizQuestions` e `lessons`).
- **`sessions`**: Histórico de sessões do **Pomodoro** e **Micro-Estudo** (`id`, `date`, `timestamp`, `subjectId`, `taskId`, `minutes`, `note`).
- **`tasks`**: Tarefas e provas do **Quadro Kanban** e **Agenda** (`id`, `title`, `subjectId`, `type`, `dueDate`, `dueTime`, `estMinutes`, `actualMinutes`, `status`).
- **`flashcards`**: Cartões de **Repetição Espaçada** (`id`, `subjectId`, `front`, `back`, `nextReview`, `reviewsCount`).
- **`hydration`**: Mapa chave-valor (`{ 'YYYY-MM-DD': ml }`) utilizado para os cálculos diário, semanal (7 barras) e mensal (30 dias).
- **`sleepLog`**: Mapa chave-valor (`{ 'YYYY-MM-DD': horas }`) cruzado com os turnos das sessões (*Madrugada, Manhã, Tarde, Noite*).
- **`schedule`**: Objeto mapeando os dias de `'Segunda'` a `'Domingo'` ao `id` da matéria prioritária.

## 4. Design System ("Dark Club / Lavo")
- **Paleta Hexadecimal**:
  - **`#0f1820` (`--bg-deep`)**: Fundo azul-petróleo/chumbo fosco com textura geométrica.
  - **`#15222e` (`--bg-card`)**: Superfície de cartões com cantos retos (`border-radius: 0`).
  - **`#f2295b` (`--accent-crimson`)**: Vermelho carmesim para títulos, botões principais e alertas.
  - **`#00c8ff` (`--accent-cyan`)**: Ciano elétrico para subtítulos de unidades, bordas `outline` e indicadores ativos.
  - **`#10b981` (`--accent-green`)**: Verde esmeralda para metas concluídas.
- **Tipografia**: **`Oswald`** (títulos condensados, relógios e datas) e **`Plus Jakarta Sans`** (leitura de interface).

## 5. Soluções de Engenharia & Mobile (Troubleshooting)
- **Blindagem de Timer em Segundo Plano**: Uso de carimbo de tempo real (`pomoTargetEndTime = Date.now() + pomoSecondsLeft * 1000`) recalculado no evento `visibilitychange` para evitar congelamento do `setInterval` quando a tela do Android é bloqueada.
- **Safe Area & Gaveta Mobile**: Aplicação de `env(safe-area-inset-top)` no cabeçalho e cálculo dinâmico via `bottomNav.offsetHeight` na função `toggleMobMoreDrawer()` para evitar sobreposição pela barra de gestos do Android.
- **Feedback Tátil & Gestos**: Integração com a **Web Vibration API** (`navigator.vibrate`), navegação horizontal por *swipe* entre as 4 abas principais e *pull-to-refresh* para sincronização imediata com a nuvem.

## 6. Pipeline de Atualização do APK (Capacitor + Android Studio)
- **Passo 1**: Salvar as alterações no arquivo `index.html` dentro da pasta web configurada no projeto (`www/`).
- **Passo 2**: Rodar `npx cap sync` no terminal do **VS Code** para copiar os assets atualizados para a pasta nativa `android/`.
- **Passo 3**: No **Android Studio**, acessar **Build > Build Bundle(s) / APK(s) > Build APK(s)** e instalar o novo `app-debug.apk` no smartphone.
