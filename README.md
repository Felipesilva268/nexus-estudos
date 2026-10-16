# 🚀 Nexus Study v2.0 — Major Update

Evolução completa do painel de estudos em arquivo único (`Single-File Web App`), integrando ferramentas de computação, revisão ativa, engenharia de produtividade, mixador de áudio neural 100% offline e sincronização multiplataforma entre PC e celular[cite: 6, 7].

---

## ✨ Principais Novidades

### ☁️ Sincronização Híbrida & Mobile (PWA)
* **Ponte em Tempo Real (Firebase REST API):** Sincronização instantânea entre PC e smartphone sem necessidade de backend adicional[cite: 6, 7].
* **Persistência em 3 Camadas:** Salvamento automático no `localStorage`, nuvem privada e gravação física no arquivo `meus_dados.json` via *File System Access API*[cite: 6, 7].
* **Progressive Web App (PWA):** Suporte para instalação em tela cheia no celular e blindagem automática de arrays vazios (`normalizeCloudData`)[cite: 6, 7].

### 💻 Laboratório de Computação & Exatas
* **Ace Editor Integrado:** Editor estilo VS Code com tema *One Dark* para anotações de aulas, biblioteca de Prompts/Comandos e Fórmulas Matemáticas por matéria[cite: 6, 7].
* **Gerador Automático de Tabelas-Verdade:** Avaliador de expressões proposicionais com classificação automática em *Tautologia*, *Contradição* ou *Contingência*[cite: 6, 7].
* **Conversor de Bases & Calculadora Bitwise:** Conversão simultânea entre Decimal, Binário, Hexadecimal e Octal, além de operações bit a bit (`AND`, `OR`, `XOR`, `NOT`, `<<`, `>>`)[cite: 6, 7].
* **Terminal Python 3 no Navegador:** Execução nativa de scripts Python via WebAssembly (*Pyodide*) diretamente na aba do painel[cite: 6, 7].

### 🧠 Revisão Ativa & Prática
* **Arena de Flashcards (Estilo Anki):** Sistema de repetição espaçada com agendamento automático (*Difícil: 1d*, *Médio: 3d*, *Fácil: 7d*)[cite: 6, 7].
* **Simulados por Unidade:** Banco de questões de múltipla escolha integrado a cada unidade com correção automática e atualização direta da nota (`X/5`)[cite: 6, 7].
* **Modo Micro-Estudo (10 min):** Cronômetro relâmpago com sorteio inteligente de flashcards e aulas pendentes para estudo rápido no celular[cite: 6, 7].

### 📊 Engenharia de Produtividade & Métricas
* **Cronograma Semestral Interativo:** Definição da grade de segunda a domingo com seleção automática da matéria prioritária do dia no Pomodoro[cite: 6, 7].
* **Progresso até a Formatura:** Barra de carga horária global do curso somada automaticamente às horas de foco registradas.
* **Ciclo de Sono & Rendimento por Turno:** Monitoramento de descanso e análise de minutos estudados na *Madrugada*, *Manhã*, *Tarde* e *Noite*.
* **Gantt Acadêmico & Estimador Kanban:** Comparativo entre tempo planejado vs. tempo real gasto em cada tarefa e linha do tempo do semestre.
* **Exportador PDF Limpo:** Folha de estilo `@media print` otimizada para impressão e geração de relatórios acadêmicos.

### 🎧 Imersão 100% Offline, Ergonomia & Gamificação
* **Mural de 100 Conquistas & Insígnias:** 100 desafios divididos em 7 categorias com cálculo automático em tempo real e barra rumo ao Troféu de Platina.
* **Estúdio de Áudio de 5 Canais (Web Audio API):** Síntese em tempo real com volumes independentes para **Ruído Marrom**, **Ruído Rosa**, **Ruído Branco**, **Chuva Noturna Suave** e **Synth Lo-Fi Procedural** (100% offline, sem dependência do YouTube).
* **Modo OLED (Relógio de Mesa):** Fundo `#000000` puro com *Screen Wake Lock API* para manter a tela do celular acesa na mesa de estudos[cite: 6, 7].
* **Biohacking & Foco:** Rastreador diário de hidratação (`ml`)[cite: 6, 7], Assistente de Postura e Visão (**Regra 20-20-20**) e **Trava Antiprocrastinação (Gatekeeper)** com desafios matemáticos.
