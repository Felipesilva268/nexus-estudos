    const STORAGE_KEY = 'NEXUS_STUDY_STATE_V1';
    let appState = null;
    let fileHandle = null;

    function createSubjectTemplate(name, color, targetHours, unitCount = 4, lessonCount = 5) {
      const units = [];
      for (let u = 1; u <= unitCount; u++) {
        const lessons = [];
        for (let l = 1; l <= lessonCount; l++) {
          lessons.push({
            id: `u${u}_l${l}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
            name: `Aula ${l} - Tópico da Aula`,
            done: false,
            note: ''
          });
        }
        units.push({
          id: `u${u}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
          name: `Unidade ${u}`,
          score: null,
          lessons,
          quizQuestions: []
        });
      }
      return {
        id: 'sub_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
        name,
        color: color || '#f2295b',
        targetHours: Number(targetHours) || 40,
        minutesStudied: 0,
        units,
        prompts: [],
        formulas: []
      };
    }

    function getDefaultState() {
      return {
        settings: {
          dailyGoalMinutes: 120,
          focusMinutes: 25,
          waterGoalMl: 3000,
          bonusXp: 0,
          degreeTotalHours: 2400,
          degreeCompletedHours: 400,
          ergo2020Enabled: true,
          gatekeeperEnabled: false
        },
        subjects: [
          createSubjectTemplate('Algoritmos e Programação Estruturada', '#f2295b', 40),
          createSubjectTemplate('Lógica Matemática Computacional', '#00c8ff', 40),
          createSubjectTemplate('Sistemas Operacionais', '#10b981', 40)
        ],
        sessions: [],
        tasks: [],
        flashcards: [],
        hydration: {},
        sleepLog: {},
        schedule: { 'Segunda': [], 'Terça': [], 'Quarta': [], 'Quinta': [], 'Sexta': [], 'Sábado': [], 'Domingo': [] }
      };
    }

    function normalizeCloudData(data) {
      if (!data || typeof data !== 'object') return getDefaultState();
      
      data.settings = data.settings || {};
      data.settings.dailyGoalMinutes = Number(data.settings.dailyGoalMinutes) || 120;
      data.settings.focusMinutes = Number(data.settings.focusMinutes) || 25;
      data.settings.waterGoalMl = Number(data.settings.waterGoalMl) || 3000;
      data.settings.bonusXp = Number(data.settings.bonusXp) || 0;
      data.settings.degreeTotalHours = Number(data.settings.degreeTotalHours) || 2400;
      data.settings.degreeCompletedHours = Number(data.settings.degreeCompletedHours) || 0;
      data.settings.ergo2020Enabled = data.settings.ergo2020Enabled !== false;
      data.settings.gatekeeperEnabled = Boolean(data.settings.gatekeeperEnabled);

      data.sessions = Array.isArray(data.sessions) ? data.sessions : [];
      data.tasks = Array.isArray(data.tasks) ? data.tasks : [];
      data.flashcards = Array.isArray(data.flashcards) ? data.flashcards : [];
      data.hydration = (data.hydration && typeof data.hydration === 'object') ? data.hydration : {};
      data.sleepLog = (data.sleepLog && typeof data.sleepLog === 'object') ? data.sleepLog : {};
      data.schedule = (data.schedule && typeof data.schedule === 'object') ? data.schedule : {};
      data.subjects = Array.isArray(data.subjects) ? data.subjects : [];

      data.subjects.forEach(sub => {
        sub.prompts = Array.isArray(sub.prompts) ? sub.prompts : [];
        sub.formulas = Array.isArray(sub.formulas) ? sub.formulas : [];
        sub.units = Array.isArray(sub.units) ? sub.units : [];
        sub.units.forEach(u => {
          u.lessons = Array.isArray(u.lessons) ? u.lessons : [];
          u.quizQuestions = Array.isArray(u.quizQuestions) ? u.quizQuestions : [];
        });
      });

      return data;
    }

    function getLocalDateStr(dateObj = new Date()) {
      const y = dateObj.getFullYear();
      const m = String(dateObj.getMonth() + 1).padStart(2, '0');
      const d = String(dateObj.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    
    // Utilitário para escapar caracteres HTML e evitar XSS/Erros
    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // =========================================================================
    // PERSISTÊNCIA: LOCALSTORAGE + INDEXEDDB + FILE SYSTEM ACCESS API
    // =========================================================================
    function loadState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        appState = raw ? normalizeCloudData(JSON.parse(raw)) : getDefaultState();
      } catch (e) {
        appState = getDefaultState();
      }
    }

    // Salva no navegador, atualiza a tela e agenda o envio para a nuvem.
    // { render: false } evita redesenhar a tela (ex.: ao renomear, para não perder o foco do campo).
    async function saveState(opts = {}) {
      appState.lastUpdated = Date.now();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
      if (opts.render !== false) updateAllUI();
      if (window.NexusCloud) NexusCloud.schedulePush();
      if (fileHandle) {
        await writeToLinkedFile();
      }
    }

    function openHandleDB() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('NexusFileHandleDB', 1);
        req.onupgradeneeded = (e) => e.target.result.createObjectStore('handles');
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e);
      });
    }

    async function saveHandleToIDB(handle) {
      const db = await openHandleDB();
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, 'linkedJsonFile');
    }

    async function restoreHandleFromIDB() {
      try {
        const db = await openHandleDB();
        return new Promise((resolve) => {
          const tx = db.transaction('handles', 'readonly');
          const req = tx.objectStore('handles').get('linkedJsonFile');
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        });
      } catch {
        return null;
      }
    }

    async function initFolderSyncStatus() {
      if (!('showSaveFilePicker' in window)) {
        updateSyncBadge('unsupported');
        return;
      }
      const savedHandle = await restoreHandleFromIDB();
      if (savedHandle) {
        fileHandle = savedHandle;
        const perm = await fileHandle.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') updateSyncBadge('connected', fileHandle.name);
        else updateSyncBadge('pending', fileHandle.name);
      }
    }

    function updateSyncBadge(state, fileName = 'meus_dados.json') {
      const btn = document.getElementById('syncStatusBtn');
      const dot = document.getElementById('syncDot');
      const txt = document.getElementById('syncText');
      btn.className = 'sync-badge';

      if (state === 'connected') {
        btn.classList.add('sync-connected');
        dot.textContent = '🟢';
        txt.textContent = `Sincronizado (${fileName})`;
      } else if (state === 'pending') {
        btn.classList.add('sync-pending');
        dot.textContent = '🟡';
        txt.textContent = `Reconectar (${fileName})`;
      } else if (state === 'unsupported') {
        btn.classList.add('sync-disconnected');
        dot.textContent = '⚪';
        txt.textContent = 'Backup JSON';
      } else {
        btn.classList.add('sync-disconnected');
        dot.textContent = '⚪';
        txt.textContent = 'Pasta';
      }
    }

    async function handleFolderSyncClick() {
      if (!('showSaveFilePicker' in window)) {
        uiToast('Este navegador não grava direto em pasta. Use Chrome ou Edge no PC, ou os botões de backup.', { type: 'warning', timeout: 6000 });
        return;
      }
      try {
        if (fileHandle) {
          const perm = await fileHandle.requestPermission({ mode: 'readwrite' });
          if (perm === 'granted') {
            await writeToLinkedFile();
            updateSyncBadge('connected', fileHandle.name);
            return;
          }
        }
        fileHandle = await window.showSaveFilePicker({
          suggestedName: 'meus_dados.json',
          types: [{ description: 'Banco de Dados JSON', accept: { 'application/json': ['.json'] } }]
        });
        await saveHandleToIDB(fileHandle);
        await writeToLinkedFile();
        updateSyncBadge('connected', fileHandle.name);
      } catch (err) {}
    }

    async function writeToLinkedFile() {
      if (!fileHandle) return;
      try {
        const perm = await fileHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          updateSyncBadge('pending', fileHandle.name);
          return;
        }
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(appState, null, 2));
        await writable.close();
        updateSyncBadge('connected', fileHandle.name);
      } catch (e) {
        updateSyncBadge('pending', fileHandle.name);
      }
    }

    function exportBackupJson() {
      const blob = new Blob([JSON.stringify(appState, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `meus_dados_${getLocalDateStr()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      uiToast('Backup exportado.', { type: 'success' });
    }

    function importBackupJson(event) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const imported = JSON.parse(e.target.result);
          if (imported && Array.isArray(imported.subjects)) {
            const ok = await uiConfirm(`Importar "${file.name}"? Isso substitui todos os dados atuais (${appState.subjects.length} matérias, ${appState.sessions.length} sessões) pelos do arquivo.`,
              { title: 'Importar backup', okLabel: 'Importar e substituir', danger: true });
            if (!ok) return;
            undoable('Backup importado.', () => {
              appState = normalizeCloudData(imported);
              appState.lastUpdated = Date.now();
            });
          } else {
            uiToast('Esse arquivo não é um backup do Nexus.', { type: 'error' });
          }
        } catch {
          uiToast('Não foi possível ler o arquivo JSON.', { type: 'error' });
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    }

    function exportCleanAcademicReport() {
      window.print();
    }

    // =========================================================================
    // GAMIFICAÇÃO, NÍVEIS, PATENTES E STREAK
    // =========================================================================
    function calculateGamification() {
      let totalXP = Number(appState.settings?.bonusXp) || 0;
      const totalMins = appState.sessions.reduce((acc, s) => acc + (Number(s.minutes) || 0), 0);
      totalXP += totalMins * 2;

      appState.subjects.forEach(sub => {
        sub.units.forEach(u => {
          u.lessons.forEach(l => { if (l.done) totalXP += 25; });
          if (u.score !== null && u.score !== undefined) totalXP += Number(u.score) * 15;
        });
      });

      appState.tasks.forEach(t => { if (t.status === 'done') totalXP += 50; });
      (appState.flashcards || []).forEach(fc => { totalXP += (Number(fc.reviewsCount) || 0) * 5; });

      const waterGoal = Number(appState.settings?.waterGoalMl) || 3000;
      Object.values(appState.hydration || {}).forEach(ml => {
        if (Number(ml) >= waterGoal) totalXP += 25;
      });

      const xpPerLevel = 250;
      const level = Math.floor(totalXP / xpPerLevel) + 1;
      const xpInCurrentLevel = totalXP % xpPerLevel;
      const progressPct = Math.min(100, Math.round((xpInCurrentLevel / xpPerLevel) * 100));

      let rank = 'Iniciante';
      if (level >= 19) rank = 'Mestre da Lógica';
      else if (level >= 13) rank = 'Arquiteto de Sistemas';
      else if (level >= 8) rank = 'Compilador de Conhecimento';
      else if (level >= 4) rank = 'Estudante Dedicado';

      return { totalXP, level, xpInCurrentLevel, xpPerLevel, progressPct, rank };
    }

    function calculateStreak() {
      const studiedDates = new Set(appState.sessions.map(s => s.date));
      let streak = 0;
      const cursor = new Date();
      const todayStr = getLocalDateStr(cursor);
      if (!studiedDates.has(todayStr)) {
        cursor.setDate(cursor.getDate() - 1);
        if (!studiedDates.has(getLocalDateStr(cursor))) return 0;
      }
      while (studiedDates.has(getLocalDateStr(cursor))) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      }
      return streak;
    }

    async function changeDailyGoal() {
      const val = await uiPrompt('Quantos minutos você quer estudar por dia?', {
        title: 'Meta diária de estudo', type: 'number', min: 5, step: 5,
        value: appState.settings.dailyGoalMinutes || 120,
        validate: v => (Number(v) > 0 ? '' : 'Digite um número maior que zero.')
      });
      if (val === null) return;
      appState.settings.dailyGoalMinutes = Number(val);
      saveState();
      uiToast('Meta diária atualizada.', { type: 'success' });
    }

    // Executa uma alteração destrutiva oferecendo "Desfazer" por alguns segundos
    function undoable(message, mutate) {
      const snapshot = JSON.stringify(appState);
      mutate();
      saveState();
      if (typeof refreshCharts === 'function') refreshCharts();
      uiToast(message, {
        actionLabel: 'Desfazer',
        onAction: () => {
          appState = normalizeCloudData(JSON.parse(snapshot));
          saveState();
          if (typeof refreshCharts === 'function') refreshCharts();
          if (typeof renderFlashcardsTab === 'function') renderFlashcardsTab();
          if (typeof renderScheduleUI === 'function') renderScheduleUI();
          uiToast('Desfeito.', { type: 'success' });
        }
      });
    }

    // =========================================================================
    // ENGENHARIA DE PRODUTIVIDADE: FORMATURA & SONO/TURNOS
    // =========================================================================
    async function configureDegreeHours() {
      const vals = await uiForm({
        title: 'Carga horária do curso',
        message: 'Informe as horas oficiais do curso. O tempo de foco do app aparece separado.',
        okLabel: 'Salvar',
        fields: [
          { name: 'total', label: 'Carga horária total do curso (h)', type: 'number', min: 100, step: 10, value: appState.settings.degreeTotalHours || 2400 },
          { name: 'done', label: 'Horas já cumpridas no curso (h)', type: 'number', min: 0, step: 1, value: appState.settings.degreeCompletedHours || 0 }
        ],
        validate: v => {
          if (!(Number(v.total) >= 100)) return 'A carga total precisa ser de pelo menos 100 h.';
          if (!(Number(v.done) >= 0)) return 'As horas cumpridas não podem ser negativas.';
          if (Number(v.done) > Number(v.total)) return 'As horas cumpridas não podem passar da carga total.';
          return '';
        }
      });
      if (!vals) return;
      appState.settings.degreeTotalHours = Number(vals.total);
      appState.settings.degreeCompletedHours = Number(vals.done);
      saveState();
    }

    async function logSleepHoursToday() {
      const today = getLocalDateStr();
      const cur = appState.sleepLog?.[today] || 7;
      const val = await uiPrompt('Quantas horas você dormiu na última noite?', {
        title: 'Registrar sono', type: 'number', min: 0, max: 24, step: 0.5, value: cur,
        validate: v => (Number(v) >= 0 && Number(v) <= 24 ? '' : 'Digite um valor entre 0 e 24.')
      });
      if (val === null) return;
      if (!appState.sleepLog) appState.sleepLog = {};
      appState.sleepLog[today] = Number(val);
      saveState();
    }

    function renderProductivityMetrics() {
      const focusHours = appState.sessions.reduce((a, s) => a + (Number(s.minutes) || 0), 0) / 60;
      const baseDone = Number(appState.settings.degreeCompletedHours) || 0;
      const totalCourse = Number(appState.settings.degreeTotalHours) || 2400;
      const currentTotalDone = +baseDone.toFixed(1);
      const pct = Math.min(100, Math.round((currentTotalDone / totalCourse) * 100));
      const remaining = Math.max(0, +(totalCourse - currentTotalDone).toFixed(1));

      document.getElementById('degreeProgressBar').style.width = `${pct}%`;
      document.getElementById('degreeCompletedLabel').textContent = `${currentTotalDone}h cumpridas (${pct}%)`;
      document.getElementById('degreeRemainingLabel').textContent = `Faltam ${remaining}h para a formatura`;
      const degSub = document.getElementById('degreeSubtitleText');
      if (degSub) degSub.textContent = `Horas oficiais do curso. Seu tempo de foco registrado no app: ${focusHours.toFixed(1)}h.`;

      const shifts = { dawn: 0, morning: 0, afternoon: 0, night: 0 };
      appState.sessions.forEach(s => {
        const hour = s.timestamp ? parseInt(s.timestamp.split(':')[0], 10) : 20;
        const mins = Number(s.minutes) || 0;
        if (hour >= 0 && hour < 6) shifts.dawn += mins;
        else if (hour >= 6 && hour < 12) shifts.morning += mins;
        else if (hour >= 12 && hour < 18) shifts.afternoon += mins;
        else shifts.night += mins;
      });

      document.getElementById('shiftMinsDawn').textContent = `${shifts.dawn}m`;
      document.getElementById('shiftMinsMorning').textContent = `${shifts.morning}m`;
      document.getElementById('shiftMinsAfternoon').textContent = `${shifts.afternoon}m`;
      document.getElementById('shiftMinsNight').textContent = `${shifts.night}m`;

      const shiftNames = { dawn: 'Madrugada (00h-06h)', morning: 'Manhã (06h-12h)', afternoon: 'Tarde (12h-18h)', night: 'Noite (18h-00h)' };
      const bestShiftKey = Object.keys(shifts).reduce((a, b) => shifts[a] >= shifts[b] ? a : b);
      const todaySleep = appState.sleepLog?.[getLocalDateStr()];
      document.getElementById('sleepAvgStatusText').textContent = 
        `Sono hoje: ${todaySleep !== undefined ? todaySleep + 'h' : 'não registrado'} • Pico produtivo: ${shifts[bestShiftKey] > 0 ? shiftNames[bestShiftKey] : 'Sem dados'}`;
    }

    // =========================================================================
    // RASTREADOR DE HIDRATAÇÃO INTEGRADO
    // =========================================================================
    function getTodayWaterMl() {
      const today = getLocalDateStr();
      if (!appState.hydration) appState.hydration = {};
      return Number(appState.hydration[today]) || 0;
    }

    function getWaterCupMl() {
      return Number(appState.settings?.waterCupMl) || 250;
    }

    function addWaterMl(amount) {
      const today = getLocalDateStr();
      if (!appState.hydration) appState.hydration = {};
      const added = Number(amount);
      appState.hydration[today] = Math.max(0, getTodayWaterMl() + added);
      saveState();
      uiToast(`+${added} ml registrados (hoje: ${appState.hydration[today]} ml)`, {
        type: 'success',
        actionLabel: 'Desfazer',
        onAction: () => {
          appState.hydration[today] = Math.max(0, getTodayWaterMl() - added);
          saveState();
        }
      });
    }

    // Adiciona um "copo" no tamanho configurado
    function addWaterCup(multiplier = 1) {
      addWaterMl(getWaterCupMl() * multiplier);
    }

    async function resetWaterToday() {
      const ok = await uiConfirm('Zerar a água registrada hoje?', { title: 'Zerar hoje', okLabel: 'Zerar', danger: true });
      if (!ok) return;
      const today = getLocalDateStr();
      if (!appState.hydration) appState.hydration = {};
      undoable('Água de hoje zerada.', () => { appState.hydration[today] = 0; });
    }

    async function changeWaterGoal() {
      const vals = await uiForm({
        title: 'Água',
        okLabel: 'Salvar',
        fields: [
          { name: 'cup', label: 'Tamanho do copo (ml)', type: 'number', min: 50, max: 2000, step: 10, value: getWaterCupMl(),
            hint: 'É o quanto cada toque no botão de água registra.' },
          { name: 'goal', label: 'Meta diária (ml)', type: 'number', min: 500, step: 100, value: appState.settings.waterGoalMl || 3000 }
        ],
        validate: v => {
          if (!(Number(v.cup) >= 50 && Number(v.cup) <= 2000)) return 'O copo precisa ter entre 50 e 2000 ml.';
          if (!(Number(v.goal) >= 500)) return 'A meta precisa ser de pelo menos 500 ml.';
          return '';
        }
      });
      if (!vals) return;
      appState.settings.waterCupMl = Number(vals.cup);
      appState.settings.waterGoalMl = Number(vals.goal);
      saveState();
      uiToast('Configurações de água salvas.', { type: 'success' });
    }

    async function promptEditWaterDate(dateStr, formattedLabel) {
      if (!appState.hydration) appState.hydration = {};
      const cur = Number(appState.hydration[dateStr]) || 0;
      const val = await uiPrompt(`Quanto você bebeu em ${formattedLabel}? (ml)`, {
        title: 'Registrar água', type: 'number', min: 0, step: 50, value: cur,
        validate: v => (v !== '' && Number(v) >= 0 ? '' : 'Digite um valor em ml (0 ou mais).')
      });
      if (val === null) return;
      appState.hydration[dateStr] = Number(val);
      saveState();
    }

    function saveCustomDateWater() {
      const dInput = document.getElementById('hydroCustomDateInput');
      const mlInput = document.getElementById('hydroCustomMlInput');
      const dateStr = dInput?.value;
      const ml = Number(mlInput?.value);
      if (!dateStr || mlInput?.value === '' || isNaN(ml) || ml < 0) {
        uiToast('Escolha uma data e digite a quantidade em ml.', { type: 'warning' });
        return;
      }
      if (!appState.hydration) appState.hydration = {};
      appState.hydration[dateStr] = ml;
      if (mlInput) mlInput.value = '';
      saveState();
    }

    function updateHydrationUI() {
      if (!appState.hydration) appState.hydration = {};
      const todayStr = getLocalDateStr();
      const currentMl = getTodayWaterMl();
      const goalMl = Number(appState.settings?.waterGoalMl) || 3000;
      const pct = Math.min(100, Math.round((currentMl / goalMl) * 100));

      // 1. Atualiza Header, Aba Pomodoro e Rótulo da Aba Início
      const headerEl = document.getElementById('uiHeaderWater');
      if (headerEl) headerEl.textContent = currentMl;
      document.querySelectorAll('.js-cup-label').forEach(el => { el.textContent = getWaterCupMl(); });

      const statusEl = document.getElementById('hydrationStatusText');
      if (statusEl) statusEl.textContent = `${currentMl} / ${goalMl} ml (${pct}%)`;

      const homeLabelEl = document.getElementById('homeHydroTodayLabel');
      if (homeLabelEl) homeLabelEl.textContent = `Hoje: ${currentMl} / ${goalMl} ml (${pct}% da meta)`;

      const barEl = document.getElementById('hydrationProgressBar');
      if (barEl) barEl.style.width = `${pct}%`;

      const customDateEl = document.getElementById('hydroCustomDateInput');
      if (customDateEl && !customDateEl.value) customDateEl.value = todayStr;

      // 2. Renderiza Visão Semanal (Barras dos Últimos 7 Dias)
      const weekContainer = document.getElementById('hydroWeeklyBarsContainer');
      if (weekContainer) {
        const today = new Date();
        const colsHtml = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date(today);
          d.setDate(today.getDate() - i);
          const dStr = getLocalDateStr(d);
          const dayMl = Number(appState.hydration[dStr]) || 0;
          const dayPct = Math.min(100, Math.round((dayMl / goalMl) * 100));
          const isMet = dayMl >= goalMl;
          const isToday = (i === 0);
          const shortWeekday = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase();
          const dayMonthLabel = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
          const litersLabel = dayMl >= 1000 ? `${(dayMl / 1000).toFixed(1)}L` : `${dayMl}ml`;

          colsHtml.push(`
            <div class="hydro-day-col" onclick="promptEditWaterDate('${dStr}', '${dayMonthLabel}')" title="${dayMonthLabel}: ${dayMl} ml / ${goalMl} ml (Clique para editar)">
              <small class="fw-bold mb-1 ${isMet ? 'text-success' : 'text-info'}" style="font-size:0.68rem;">${litersLabel}</small>
              <div class="hydro-bar-track ${isToday ? 'border-info' : ''}">
                <div class="hydro-bar-fill ${isMet ? 'goal-met' : ''}" style="height: ${dayPct}%;"></div>
              </div>
              <small class="mt-1 fw-bold ${isToday ? 'text-white' : 'text-secondary'}" style="font-size:0.68rem;">${shortWeekday}</small>
            </div>
          `);
        }
        weekContainer.innerHTML = colsHtml.join('');
      }

      // 3. Renderiza Visão Mensal (Mês Atual + Mapa de 30 Dias)
      const now = new Date();
      const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const monthName = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      const monthBadge = document.getElementById('hydroMonthTitleBadge');
      if (monthBadge) monthBadge.textContent = monthName.toUpperCase();

      let monthTotalMl = 0;
      let monthActiveDays = 0;
      let monthGoalHitDays = 0;

      Object.keys(appState.hydration).forEach(dateKey => {
        if (dateKey.startsWith(currentYearMonth)) {
          const val = Number(appState.hydration[dateKey]) || 0;
          if (val > 0) {
            monthTotalMl += val;
            monthActiveDays++;
          }
          if (val >= goalMl) monthGoalHitDays++;
        }
      });

      const avgMl = monthActiveDays > 0 ? Math.round(monthTotalMl / monthActiveDays) : 0;
      const totalLitersEl = document.getElementById('hydroMonthTotalLiters');
      const avgMlEl = document.getElementById('hydroMonthAvgMl');
      const goalDaysEl = document.getElementById('hydroMonthGoalDays');

      if (totalLitersEl) totalLitersEl.textContent = `${(monthTotalMl / 1000).toFixed(1)} L`;
      if (avgMlEl) avgMlEl.textContent = `${avgMl} ml`;
      if (goalDaysEl) goalDaysEl.textContent = `${monthGoalHitDays} dias`;

      const monthGrid = document.getElementById('hydroMonthlyGridContainer');
      if (monthGrid) {
        const dotsHtml = [];
        for (let i = 29; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(now.getDate() - i);
          const dStr = getLocalDateStr(d);
          const ml = Number(appState.hydration[dStr]) || 0;
          const dayNum = String(d.getDate()).padStart(2, '0');
          const fullLabel = d.toLocaleDateString('pt-BR');
          const statusClass = ml >= goalMl ? 'met' : (ml > 0 ? 'partial' : '');

          dotsHtml.push(`
            <div class="hydro-month-Dot ${statusClass}" onclick="promptEditWaterDate('${dStr}', '${fullLabel}')" title="${fullLabel}: ${ml} ml">
              ${dayNum}
            </div>
          `);
        }
        monthGrid.innerHTML = dotsHtml.join('');
      }
    }

    // =========================================================================
    // GERENCIAMENTO DE MATÉRIAS (ESTILO "BAR MENU ." - 4 UNIDADES x 5 AULAS)
    // =========================================================================

    // ---------- Estrutura flexível: unidades e aulas ----------
    function countLessons(sub) {
      return sub.units.reduce((acc, u) => acc + u.lessons.length, 0);
    }
    function countDoneLessons(sub) {
      return sub.units.reduce((acc, u) => acc + u.lessons.filter(l => l.done).length, 0);
    }
    function newLesson(n) {
      return { id: `l_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name: `Aula ${n} - Tópico da Aula`, done: false, note: '' };
    }

    function addLesson(subId, unitId) {
      const unit = appState.subjects.find(s => s.id === subId)?.units.find(u => u.id === unitId);
      if (!unit) return;
      unit.lessons.push(newLesson(unit.lessons.length + 1));
      saveState();
    }

    async function removeLesson(subId, unitId, lessonId) {
      const unit = appState.subjects.find(s => s.id === subId)?.units.find(u => u.id === unitId);
      const lesson = unit?.lessons.find(l => l.id === lessonId);
      if (!lesson) return;
      if (lesson.note && lesson.note.trim()) {
        const ok = await uiConfirm(`"${lesson.name}" tem anotações. Remover mesmo assim?`, { title: 'Remover aula', okLabel: 'Remover', danger: true });
        if (!ok) return;
      }
      undoable(`"${lesson.name}" removida.`, () => {
        const u = appState.subjects.find(s => s.id === subId).units.find(x => x.id === unitId);
        u.lessons = u.lessons.filter(l => l.id !== lessonId);
      });
    }

    function addUnit(subId) {
      const sub = appState.subjects.find(s => s.id === subId);
      if (!sub) return;
      const n = sub.units.length + 1;
      sub.units.push({
        id: `u${n}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: `Unidade ${n}`,
        score: null,
        lessons: [1, 2, 3, 4, 5].map(newLesson),
        quizQuestions: []
      });
      saveState();
    }

    async function removeUnit(subId, unitId) {
      const sub = appState.subjects.find(s => s.id === subId);
      const unit = sub?.units.find(u => u.id === unitId);
      if (!unit) return;
      const ok = await uiConfirm(`Remover "${unit.name}" com ${unit.lessons.length} aulas, anotações e simulado?`, { title: 'Remover unidade', okLabel: 'Remover', danger: true });
      if (!ok) return;
      undoable(`"${unit.name}" removida.`, () => {
        const s = appState.subjects.find(x => x.id === subId);
        s.units = s.units.filter(u => u.id !== unitId);
      });
    }

    function handleCreateSubject(e) {
      e.preventDefault();
      const name = document.getElementById('newSubName').value.trim();
      const targetHours = document.getElementById('newSubTargetHours').value;
      const color = document.getElementById('newSubColor').value;
      const unitCount = Math.min(12, Math.max(1, Number(document.getElementById('newSubUnits')?.value) || 4));
      const lessonCount = Math.min(30, Math.max(1, Number(document.getElementById('newSubLessons')?.value) || 5));
      if (!name) return;

      appState.subjects.push(createSubjectTemplate(name, color, targetHours, unitCount, lessonCount));
      uiToast(`"${name}" criada com ${unitCount} unidades de ${lessonCount} aulas.`, { type: 'success' });
      document.getElementById('newSubName').value = '';
      saveState();
      refreshCharts();
    }

    async function deleteSubject(subId) {
      const sub = appState.subjects.find(s => s.id === subId);
      if (!sub) return;
      const ok = await uiConfirm(`Excluir "${sub.name}" com todas as aulas, anotações e simulados?`, { title: 'Excluir matéria', okLabel: 'Excluir', danger: true });
      if (!ok) return;
      undoable(`"${sub.name}" excluída.`, () => {
        appState.subjects = appState.subjects.filter(s => s.id !== subId);
      });
    }

    function renameSubject(subId, newName) {
      const sub = appState.subjects.find(s => s.id === subId);
      if (sub && newName.trim()) {
        sub.name = newName.trim();
        saveState({ render: false });
        refreshCharts();
      }
    }

    function renameUnit(subId, unitId, newName) {
      const sub = appState.subjects.find(s => s.id === subId);
      const unit = sub?.units.find(u => u.id === unitId);
      if (unit && newName.trim()) {
        unit.name = newName.trim();
        saveState({ render: false });
      }
    }

    function renameLesson(subId, unitId, lessonId, newName) {
      const sub = appState.subjects.find(s => s.id === subId);
      const unit = sub?.units.find(u => u.id === unitId);
      const lesson = unit?.lessons.find(l => l.id === lessonId);
      if (lesson && newName.trim()) {
        lesson.name = newName.trim();
        saveState({ render: false });
      }
    }

    function toggleLessonDone(subId, unitId, lessonId, checked) {
      const sub = appState.subjects.find(s => s.id === subId);
      const unit = sub?.units.find(u => u.id === unitId);
      const lesson = unit?.lessons.find(l => l.id === lessonId);
      if (lesson) {
        lesson.done = checked;
        saveState();
      }
    }

    function updateUnitScore(subId, unitId, value) {
      const sub = appState.subjects.find(s => s.id === subId);
      const unit = sub?.units.find(u => u.id === unitId);
      if (unit) {
        unit.score = value === '' ? null : Number(value);
        saveState();
        refreshCharts();
      }
    }

    function renderSubjects() {
      const container = document.getElementById('subjectsContainer');
      if (appState.subjects.length === 0) {
        container.innerHTML = `<div class="nexus-card p-5 text-center text-secondary">Nenhuma matéria cadastrada. Adicione sua primeira matéria acima!</div>`;
        return;
      }

      container.innerHTML = appState.subjects.map(sub => {
        let lessonsDone = 0;
        let totalScore = 0;
        let unitsScored = 0;

        sub.units.forEach(u => {
          u.lessons.forEach(l => { if (l.done) lessonsDone++; });
          if (u.score !== null && u.score !== undefined) {
            totalScore += Number(u.score);
            unitsScored++;
          }
        });

        const totalLessonsSub = countLessons(sub);
        const progressPct = totalLessonsSub ? Math.round((lessonsDone / totalLessonsSub) * 100) : 0;
        const hoursStudied = (sub.minutesStudied / 60).toFixed(1);
        const maxPossibleScore = unitsScored * 5;
        const quizDisplay = unitsScored > 0
          ? `${totalScore}/${maxPossibleScore} acertos (${Math.round((totalScore / maxPossibleScore) * 100)}%)`
          : 'Sem notas registradas';

        return `
          <div class="nexus-card p-4">
            <!-- Cabeçalho Limpo da Matéria -->
            <div class="d-flex justify-content-between align-items-start flex-wrap gap-3 mb-3">
              <div class="flex-grow-1">
                <div class="d-flex align-items-center gap-2">
                  <span class="subject-dot" style="background:${sub.color};"></span>
                  <input type="text" class="editable-input fs-5 fw-semibold" value="${escapeHtml(sub.name)}"
                    onchange="renameSubject('${sub.id}', this.value)" title="Clique para renomear a matéria">
                </div>
                <div class="d-flex flex-wrap gap-4 mt-1 small text-secondary px-1">
                  <span><strong class="text-white">${hoursStudied}h</strong> / ${sub.targetHours}h estudadas</span>
                  <span><strong class="text-info">${lessonsDone}/${totalLessonsSub}</strong> aulas (${progressPct}%)</span>
                  <span>Exercícios: <strong class="text-white">${quizDisplay}</strong></span>
                </div>
              </div>
              <div class="d-flex align-items-center gap-2 flex-wrap">
                <button class="btn btn-outline-nexus btn-sm px-3" onclick="openSubjectRepoModal('${sub.id}', 'prompts')">
                  <i class="bi bi-terminal me-1"></i> Prompts
                </button>
                <button class="btn btn-outline-nexus btn-sm px-3" onclick="openSubjectRepoModal('${sub.id}', 'formulas')">
                  <i class="bi bi-calculator me-1"></i> Fórmulas
                </button>
                <button class="btn btn-outline-danger btn-sm" onclick="deleteSubject('${sub.id}')" title="Excluir matéria">
                  <i class="bi bi-trash"></i>
                </button>
              </div>
            </div>

            <div class="progress mb-4" style="height: 5px; background-color: var(--surface-inset);">
              <div class="progress-bar" style="width: ${progressPct}%; background-color: ${sub.color};"></div>
            </div>

            <!-- 4 Unidades Estilo "Bar Menu" (Vodka / Tequila / Rum) -->
            <div class="row g-4">
              ${sub.units.map((u, uIdx) => {
                const uDone = u.lessons.filter(l => l.done).length;
                const uPct = u.lessons.length ? Math.round((uDone / u.lessons.length) * 100) : 0;
                const qCount = (u.quizQuestions || []).length;
                return `
                  <div class="col-12 col-md-6 col-xl-3">
                    <div class="unit-menu-card">
                      <div>
                        <div class="unit-menu-header">
                          <input type="text" class="editable-input unit-menu-title" value="${escapeHtml(u.name)}"
                            onchange="renameUnit('${sub.id}', '${u.id}', this.value)" title="Renomear Unidade ${uIdx + 1}">
                          <div class="d-flex justify-content-between align-items-center mt-1 px-1">
                            <small class="text-secondary" style="font-size:0.75rem;">${uDone}/${u.lessons.length} aulas · ${uPct}%</small>
                            <button type="button" class="lesson-remove-btn" onclick="removeUnit('${sub.id}', '${u.id}')" title="Remover unidade" aria-label="Remover unidade"><i class="bi bi-trash"></i></button>
                          </div>
                        </div>

                        <div class="d-flex flex-column gap-2 mb-4">
                          ${u.lessons.map(l => `
                            <div class="d-flex align-items-center justify-content-between gap-2 py-1 border-bottom border-secondary border-opacity-10">
                              <input type="checkbox" class="form-check-input mt-0" style="cursor:pointer;"
                                ${l.done ? 'checked' : ''}
                                onchange="toggleLessonDone('${sub.id}', '${u.id}', '${l.id}', this.checked)">
                              <input type="text" class="editable-input small ${l.done ? 'lesson-done' : ''}"
                                value="${escapeHtml(l.name)}"
                                onchange="renameLesson('${sub.id}', '${u.id}', '${l.id}', this.value)">
                              <button type="button" class="lesson-remove-btn" onclick="removeLesson('${sub.id}', '${u.id}', '${l.id}')" title="Remover aula" aria-label="Remover aula"><i class="bi bi-x"></i></button>
                              <button type="button" class="lesson-note-btn ${l.note ? 'has-notes' : ''}"
                                onclick="openLessonNoteModal('${sub.id}', '${u.id}', '${l.id}')"
                                title="${l.note ? 'Ver/Editar Anotação' : 'Adicionar Anotação'}">
                                <i class="bi bi-journal-text"></i>
                              </button>
                            </div>
                          `).join('')}
                          <button type="button" class="btn btn-sm btn-link text-secondary text-start px-1" onclick="addLesson('${sub.id}', '${u.id}')"><i class="bi bi-plus"></i> Adicionar aula</button>
                        </div>
                      </div>

                      <div class="pt-3 border-top border-secondary border-opacity-25">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                          <small class="text-secondary text-uppercase" style="font-size:0.72rem;">Acertos:</small>
                          <select class="form-select form-select-sm bg-dark border-secondary text-white" style="width: 115px;"
                            onchange="updateUnitScore('${sub.id}', '${u.id}', this.value)">
                            <option value="" ${u.score === null ? 'selected' : ''}>Pendente</option>
                            <option value="0" ${u.score === 0 ? 'selected' : ''}>0 / 5 (0%)</option>
                            <option value="1" ${u.score === 1 ? 'selected' : ''}>1 / 5 (20%)</option>
                            <option value="2" ${u.score === 2 ? 'selected' : ''}>2 / 5 (40%)</option>
                            <option value="3" ${u.score === 3 ? 'selected' : ''}>3 / 5 (60%)</option>
                            <option value="4" ${u.score === 4 ? 'selected' : ''}>4 / 5 (80%)</option>
                            <option value="5" ${u.score === 5 ? 'selected' : ''}>5 / 5 (100%)</option>
                          </select>
                        </div>
                        <button class="btn btn-outline-nexus btn-sm w-100 py-1" onclick="openUnitQuizModal('${sub.id}', '${u.id}')">
                          Simulado (${qCount})
                        </button>
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
              <div class="col-12 col-md-6 col-xl-3">
                <button type="button" class="add-unit-card" onclick="addUnit('${sub.id}')"><i class="bi bi-plus-lg"></i><span>Adicionar unidade</span></button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    // =========================================================================
    // SIMULADO DE MÚLTIPLA ESCOLHA POR UNIDADE
    // =========================================================================
    let currentQuizTarget = { subId: null, unitId: null };

    function openUnitQuizModal(subId, unitId) {
      const sub = appState.subjects.find(s => s.id === subId);
      const unit = sub?.units.find(u => u.id === unitId);
      if (!unit) return;

      currentQuizTarget = { subId, unitId };
      document.getElementById('unitQuizModalTitle').innerHTML = `Simulado: ${escapeHtml(sub.name)} — ${escapeHtml(unit.name)}`;
      document.getElementById('uqResultBadge').className = 'badge bg-dark border border-secondary';
      document.getElementById('uqResultBadge').textContent = 'Responda e clique em Corrigir';

      renderUnitQuizQuestions();
      const modal = new bootstrap.Modal(document.getElementById('unitQuizModal'));
      modal.show();
    }

    function handleAddUnitQuestion(e) {
      e.preventDefault();
      const sub = appState.subjects.find(s => s.id === currentQuizTarget.subId);
      const unit = sub?.units.find(u => u.id === currentQuizTarget.unitId);
      if (!unit) return;

      if (!Array.isArray(unit.quizQuestions)) unit.quizQuestions = [];
      unit.quizQuestions.push({
        id: 'uq_' + Date.now(),
        q: document.getElementById('uqQuestion').value.trim(),
        options: [
          document.getElementById('uqOptA').value.trim(),
          document.getElementById('uqOptB').value.trim(),
          document.getElementById('uqOptC').value.trim(),
          document.getElementById('uqOptD').value.trim()
        ],
        correct: Number(document.getElementById('uqCorrect').value)
      });

      document.getElementById('uqQuestion').value = '';
      document.getElementById('uqOptA').value = '';
      document.getElementById('uqOptB').value = '';
      document.getElementById('uqOptC').value = '';
      document.getElementById('uqOptD').value = '';

      saveState();
      renderUnitQuizQuestions();
    }

    function deleteUnitQuestion(qId) {
      const sub = appState.subjects.find(s => s.id === currentQuizTarget.subId);
      const unit = sub?.units.find(u => u.id === currentQuizTarget.unitId);
      if (!unit) return;
      undoable('Questão excluída.', () => {
        unit.quizQuestions = (unit.quizQuestions || []).filter(item => item.id !== qId);
      });
      renderUnitQuizQuestions();
    }

    function renderUnitQuizQuestions() {
      const container = document.getElementById('uqQuestionsRunContainer');
      const sub = appState.subjects.find(s => s.id === currentQuizTarget.subId);
      const unit = sub?.units.find(u => u.id === currentQuizTarget.unitId);
      const list = unit?.quizQuestions || [];

      if (list.length === 0) {
        container.innerHTML = `<div class="text-secondary text-center py-4 small">Nenhuma questão cadastrada nesta unidade ainda.</div>`;
        return;
      }

      const letters = ['A', 'B', 'C', 'D'];
      container.innerHTML = list.map((item, idx) => `
        <div class="p-3" style="background:var(--surface-inset); border:1px solid var(--border-subtle); border-radius:var(--radius-sm);" id="uqBox_${item.id}">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <span class="fw-bold small text-white">${idx + 1}. ${escapeHtml(item.q)}</span>
            <button class="btn btn-outline-danger btn-sm py-0 px-2" onclick="deleteUnitQuestion('${item.id}')"><i class="bi bi-trash"></i></button>
          </div>
          <div class="d-flex flex-column gap-1">
            ${item.options.map((opt, oIdx) => `
              <label class="d-flex align-items-center gap-2 small text-secondary" style="cursor:pointer;">
                <input type="radio" name="uqRadio_${item.id}" value="${oIdx}" class="form-check-input mt-0">
                <span><strong>${letters[oIdx]})</strong> ${escapeHtml(opt)}</span>
              </label>
            `).join('')}
          </div>
        </div>
      `).join('');
    }

    function gradeUnitQuiz() {
      const sub = appState.subjects.find(s => s.id === currentQuizTarget.subId);
      const unit = sub?.units.find(u => u.id === currentQuizTarget.unitId);
      const list = unit?.quizQuestions || [];
      if (list.length === 0) return;

      let hits = 0;
      list.forEach(item => {
        const selected = document.querySelector(`input[name="uqRadio_${item.id}"]:checked`);
        const box = document.getElementById(`uqBox_${item.id}`);
        if (selected && Number(selected.value) === Number(item.correct)) {
          hits++;
          if (box) box.style.borderColor = '#10b981';
        } else {
          if (box) box.style.borderColor = '#f2295b';
        }
      });

      const pct = Math.round((hits / list.length) * 100);
      const scaledScore = Math.round((hits / list.length) * 5);
      unit.score = scaledScore;
      appState.settings.bonusXp = (Number(appState.settings.bonusXp) || 0) + 20;

      const badge = document.getElementById('uqResultBadge');
      badge.className = 'badge bg-success';
      badge.textContent = `Acertos: ${hits}/${list.length} (${pct}%) -> Nota ${scaledScore}/5 salva (+20 XP)`;

      saveState();
      refreshCharts();
    }

    // =========================================================================
    // POMODORO TIMER, REGRA 20-20-20, GATEKEEPER & MODO OLED
    // =========================================================================
    let pomoMode = 'focus';
    let pomoSecondsLeft = 25 * 60;
    let pomoTotalSeconds = 25 * 60;
    let pomoInterval = null;
    let pendingSessionMinutes = 0;
    let wakeLockSentinel = null;

    function playFinishBeep() {
      try {
        ensureAudioContext();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
        osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.18);
        gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.65);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.65);
      } catch {}
    }

    function playSoftErgoChime() {
      try {
        ensureAudioContext();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(528, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.5);
      } catch {}
    }

    function toggleErgo2020() {
      appState.settings.ergo2020Enabled = !appState.settings.ergo2020Enabled;
      document.getElementById('btnErgo2020')?.classList.toggle('active', appState.settings.ergo2020Enabled);
      saveState();
    }

    function toggleGatekeeperMode() {
      appState.settings.gatekeeperEnabled = !appState.settings.gatekeeperEnabled;
      document.getElementById('btnGatekeeper')?.classList.toggle('active', appState.settings.gatekeeperEnabled);
      saveState();
    }

    // ---------- Estado do Pomodoro salvo no navegador (sobrevive ao recarregar) ----------
    const POMO_KEY = 'NEXUS_POMO_V1';
    let pomoTargetEndTime = null;
    let pomoLastErgoMark = 0;
    let pendingSession = null; // { minutes, subjectId, taskId }

    function persistPomoState() {
      try {
        localStorage.setItem(POMO_KEY, JSON.stringify({
          mode: pomoMode,
          totalSeconds: pomoTotalSeconds,
          secondsLeft: pomoSecondsLeft,
          running: Boolean(pomoInterval),
          endTime: pomoTargetEndTime,
          subjectId: document.getElementById('pomoSubjectSelect')?.value || '',
          taskId: document.getElementById('pomoTaskSelect')?.value || '',
          pending: pendingSession
        }));
      } catch {}
    }

    function readPomoState() {
      try { return JSON.parse(localStorage.getItem(POMO_KEY) || 'null'); } catch { return null; }
    }

    function setModeButtons(mode) {
      document.getElementById('modeBtnFocus').classList.toggle('active', mode === 'focus');
      document.getElementById('modeBtnShort').classList.toggle('active', mode === 'short');
      document.getElementById('modeBtnLong').classList.toggle('active', mode === 'long');
      document.getElementById('breakHydrationBanner').classList.toggle('d-none', mode === 'focus');
    }

    function secondsForMode(mode) {
      if (mode === 'short') return 5 * 60;
      if (mode === 'long') return 15 * 60;
      return (appState.settings.focusMinutes || 25) * 60;
    }

    // Restaura o timer depois de recarregar a página
    function restorePomodoroFromStorage() {
      const saved = readPomoState();
      if (!saved) return;

      pomoMode = ['focus', 'short', 'long'].includes(saved.mode) ? saved.mode : 'focus';
      pomoTotalSeconds = Number(saved.totalSeconds) || secondsForMode(pomoMode);
      setModeButtons(pomoMode);

      const subSel = document.getElementById('pomoSubjectSelect');
      if (subSel && saved.subjectId && [...subSel.options].some(o => o.value === saved.subjectId)) subSel.value = saved.subjectId;
      const taskSel = document.getElementById('pomoTaskSelect');
      if (taskSel && saved.taskId && [...taskSel.options].some(o => o.value === saved.taskId)) taskSel.value = saved.taskId;

      if (saved.pending && Number(saved.pending.minutes) > 0) {
        pomoSecondsLeft = 0;
        updatePomodoroClockUI();
        openSessionModal(Number(saved.pending.minutes), saved.pending);
        return;
      }

      if (saved.running && saved.endTime) {
        const left = Math.round((saved.endTime - Date.now()) / 1000);
        if (left > 0) {
          pomoSecondsLeft = left;
          pomoLastErgoMark = Math.floor((pomoTotalSeconds - left) / 1200);
          startPomodoro();
          uiToast('Seu timer continuou de onde parou.', { type: 'info' });
        } else {
          // Terminou enquanto a página estava fechada
          pomoSecondsLeft = 0;
          onPomodoroFinished(true);
        }
        return;
      }

      pomoSecondsLeft = Math.min(pomoTotalSeconds, Math.max(0, Number(saved.secondsLeft) || pomoTotalSeconds));
      updatePomodoroClockUI();
    }

    async function verifyGatekeeperChallenge() {
      if (!appState.settings?.gatekeeperEnabled || !pomoInterval || pomoMode !== 'focus') return true;
      const a = Math.floor(Math.random() * 12) + 4;
      const b = Math.floor(Math.random() * 9) + 3;
      const ans = await uiPrompt(`Para interromper o foco antes da hora, resolva: (${a} × ${b}) + ${a}`, {
        title: '🛡️ Trava de foco', type: 'number', okLabel: 'Responder'
      });
      if (ans === null) return false;
      if (Number(ans) !== (a * b + a)) {
        uiToast('Resposta incorreta. Mantenha o foco!', { type: 'warning' });
        return false;
      }
      return true;
    }

    async function setPomodoroMode(mode, { force = false } = {}) {
      const elapsed = pomoTotalSeconds - pomoSecondsLeft;
      if (!force && pomoMode === 'focus' && elapsed >= 60 && mode !== pomoMode) {
        const ok = await uiConfirm(`Você já tem ${Math.round(elapsed / 60)} min de foco nesta sessão. Trocar de modo descarta esse tempo.`,
          { title: 'Trocar de modo?', okLabel: 'Descartar e trocar', danger: true });
        if (!ok) return;
      }
      stopPomoTicker();
      pomoMode = mode;
      setModeButtons(mode);
      pomoTotalSeconds = secondsForMode(mode);
      pomoSecondsLeft = pomoTotalSeconds;
      pomoLastErgoMark = 0;
      updatePomodoroClockUI();
      persistPomoState();
    }

    function changeCustomFocusTime(mins) {
      appState.settings.focusMinutes = mins;
      document.getElementById('lblFocusMins').textContent = mins;
      saveState();
      setPomodoroMode('focus', { force: true });
    }

    function updatePomodoroClockUI() {
      const m = String(Math.floor(pomoSecondsLeft / 60)).padStart(2, '0');
      const s = String(pomoSecondsLeft % 60).padStart(2, '0');
      document.getElementById('pomoClockDisplay').textContent = `${m}:${s}`;
      document.title = pomoInterval ? `(${m}:${s}) Nexus Study` : 'Nexus Study';
      const btn = document.getElementById('pomoStartPauseBtn');
      if (btn) {
        const paused = pomoSecondsLeft > 0 && pomoSecondsLeft < pomoTotalSeconds;
        btn.innerHTML = pomoInterval
          ? `<i class="bi bi-pause-fill me-1"></i> Pausar`
          : `<i class="bi bi-play-fill me-1"></i> ${paused ? 'Continuar' : 'Iniciar'}`;
      }
    }

    async function togglePomodoro() {
      if (pomoInterval) {
        if (!(await verifyGatekeeperChallenge())) return;
        stopPomoTicker();
        updatePomodoroClockUI();
        persistPomoState();
      } else {
        startPomodoro();
      }
    }

    function stopPomoTicker() {
      clearInterval(pomoInterval);
      pomoInterval = null;
      pomoTargetEndTime = null;
    }

    function startPomodoro() {
      if (pomoMode === 'focus' && appState.subjects.length === 0) {
        uiToast('Cadastre pelo menos uma matéria antes de iniciar o foco.', { type: 'warning' });
        return;
      }
      if (pomoSecondsLeft <= 0) pomoSecondsLeft = pomoTotalSeconds;

      pomoTargetEndTime = Date.now() + (pomoSecondsLeft * 1000);
      clearInterval(pomoInterval);
      pomoInterval = setInterval(pomoTick, 1000);
      updatePomodoroClockUI();
      persistPomoState();
    }

    function pomoTick() {
      pomoSecondsLeft = Math.max(0, Math.round((pomoTargetEndTime - Date.now()) / 1000));
      updatePomodoroClockUI();

      // Lembrete 20-20-20: dispara a cada 20 min de foco, mesmo se o navegador atrasar o timer
      const elapsed = pomoTotalSeconds - pomoSecondsLeft;
      const mark = Math.floor(elapsed / 1200);
      if (pomoMode === 'focus' && appState.settings?.ergo2020Enabled && mark > pomoLastErgoMark && pomoSecondsLeft > 0) {
        pomoLastErgoMark = mark;
        playSoftErgoChime();
        triggerHaptic([40, 60, 40]);
        const ergoEl = document.getElementById('ergoPostureStatus');
        if (ergoEl) {
          ergoEl.innerHTML = `<span class="text-warning fw-bold">👀 Regra 20-20-20: olhe a 6 m por 20 s e alinhe a coluna!</span>`;
          setTimeout(() => { ergoEl.textContent = '🪑 Postura ereta • Olhos relaxados'; }, 20000);
        }
      }

      if (pomoSecondsLeft <= 0) onPomodoroFinished(false);
    }

    function onPomodoroFinished(whileAway) {
      stopPomoTicker();
      pomoLastErgoMark = 0;
      playFinishBeep();
      if (pomoMode === 'focus') {
        openSessionModal(Math.round(pomoTotalSeconds / 60));
        if (whileAway) uiToast('Seu foco terminou enquanto a página estava fechada.', { type: 'info' });
      } else {
        uiToast('Pausa encerrada. Bora voltar ao foco!', { type: 'info' });
        setPomodoroMode('focus', { force: true });
      }
    }

    async function pausePomodoro(skipGate = false) {
      if (!skipGate && !(await verifyGatekeeperChallenge())) return;
      stopPomoTicker();
      updatePomodoroClockUI();
      persistPomoState();
    }

    async function resetPomodoro() {
      if (!(await verifyGatekeeperChallenge())) return;
      stopPomoTicker();
      pomoSecondsLeft = pomoTotalSeconds;
      pomoLastErgoMark = 0;
      updatePomodoroClockUI();
      persistPomoState();
    }

    async function finishFocusSessionEarly() {
      if (pomoMode !== 'focus') return;
      const elapsedSecs = pomoTotalSeconds - pomoSecondsLeft;
      if (elapsedSecs < 60) {
        uiToast('Estude pelo menos 1 minuto antes de salvar a sessão.', { type: 'warning' });
        return;
      }
      if (!(await verifyGatekeeperChallenge())) return;
      stopPomoTicker();
      updatePomodoroClockUI();
      openSessionModal(Math.round(elapsedSecs / 60));
    }

    function openSessionModal(mins, restored = null) {
      pendingSession = {
        minutes: mins,
        subjectId: restored?.subjectId || document.getElementById('pomoSubjectSelect')?.value || '',
        taskId: restored?.taskId || document.getElementById('pomoTaskSelect')?.value || ''
      };
      pendingSessionMinutes = mins;
      persistPomoState();

      const subSel = document.getElementById('modalSessionSubject');
      if (subSel) {
        subSel.innerHTML = appState.subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
        if (pendingSession.subjectId) subSel.value = pendingSession.subjectId;
      }
      const minsInput = document.getElementById('modalSessionMinsInput');
      if (minsInput) minsInput.value = mins;
      document.getElementById('modalSessionMins').textContent = mins;
      document.getElementById('modalSessionNote').value = '';
      bootstrap.Modal.getOrCreateInstance(document.getElementById('sessionCompleteModal')).show();
    }

    function closeSessionModalAndReset() {
      pendingSession = null;
      pendingSessionMinutes = 0;
      bootstrap.Modal.getInstance(document.getElementById('sessionCompleteModal'))?.hide();
      stopPomoTicker();
      pomoSecondsLeft = pomoTotalSeconds;
      pomoLastErgoMark = 0;
      updatePomodoroClockUI();
      persistPomoState();
    }

    async function discardPendingSession() {
      const ok = await uiConfirm(`Descartar ${pendingSessionMinutes} min de foco sem registrar?`,
        { title: 'Descartar sessão', okLabel: 'Descartar', danger: true });
      if (ok) closeSessionModalAndReset();
    }

    function confirmSaveSession() {
      const subId = document.getElementById('modalSessionSubject')?.value || pendingSession?.subjectId || document.getElementById('pomoSubjectSelect').value;
      const taskId = pendingSession?.taskId || '';
      const minsVal = Number(document.getElementById('modalSessionMinsInput')?.value) || pendingSessionMinutes;
      const minutes = Math.max(1, Math.min(600, Math.round(minsVal)));
      const note = document.getElementById('modalSessionNote').value.trim() || 'Sessão de foco Pomodoro';
      const sub = appState.subjects.find(s => s.id === subId);

      if (sub) sub.minutesStudied = (Number(sub.minutesStudied) || 0) + minutes;

      if (taskId) {
        const linkedTask = appState.tasks.find(t => t.id === taskId);
        if (linkedTask) linkedTask.actualMinutes = (Number(linkedTask.actualMinutes) || 0) + minutes;
      }

      appState.sessions.unshift({
        id: 'sess_' + Date.now(),
        date: getLocalDateStr(),
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        subjectId: subId,
        taskId,
        minutes,
        note
      });

      closeSessionModalAndReset();
      saveState();
      refreshCharts();
      uiToast(`Sessão de ${minutes} min registrada (+${minutes * 2} XP).`, { type: 'success' });
    }

    function toggleFocusMode() {
      document.body.classList.toggle('focus-mode');
    }

    async function toggleOledMode() {
      const isOled = document.body.classList.toggle('oled-mode');
      const btn = document.getElementById('btnOledMode');
      if (btn) btn.classList.toggle('active', isOled);

      if (isOled && 'wakeLock' in navigator) {
        try { wakeLockSentinel = await navigator.wakeLock.request('screen'); } catch {}
      } else if (!isOled && wakeLockSentinel) {
        try { await wakeLockSentinel.release(); wakeLockSentinel = null; } catch {}
      }
    }

    document.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const pomoTab = document.getElementById('tab-pomodoro');
      if (e.code === 'Space' && pomoTab.classList.contains('active')) {
        e.preventDefault();
        togglePomodoro();
      }
    });

    // =========================================================================
    // MIXADOR OFFLINE DE 5 CANAIS (MARROM, ROSA, BRANCO, CHUVA E LO-FI SYNTH)
    // =========================================================================
    let audioCtx = null;
    const mixChannels = {
      brown: { active: false, source: null, gain: null, volume: 0.45 },
      pink:  { active: false, source: null, gain: null, volume: 0.35 },
      white: { active: false, source: null, gain: null, volume: 0.25 },
      rain:  { active: false, source: null, gain: null, volume: 0.40 }
    };

    let lofiState = { active: false, interval: null, volume: 0.30 };

    function ensureAudioContext() {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
    }

    function toggleMixChannel(type) {
      const ch = mixChannels[type];
      if (!ch) return;
      if (ch.active) stopMixChannel(type);
      else startMixChannel(type);
    }

    function startMixChannel(type) {
      const ch = mixChannels[type];
      if (!ch) return;
      stopMixChannel(type);
      ensureAudioContext();

      const bufferSize = 2 * audioCtx.sampleRate;
      const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const output = noiseBuffer.getChannelData(0);

      if (type === 'brown') {
        let lastOut = 0.0;
        for (let i = 0; i < bufferSize; i++) {
          const white = Math.random() * 2 - 1;
          output[i] = (lastOut + (0.02 * white)) / 1.02;
          lastOut = output[i];
          output[i] *= 3.5;
        }
      } else if (type === 'pink') {
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        for (let i = 0; i < bufferSize; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.96900 * b2 + white * 0.1538520;
          b3 = 0.86650 * b3 + white * 0.3104856;
          b4 = 0.55000 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.0168980;
          output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
          output[i] *= 0.04;
          b6 = white * 0.115926;
        }
      } else if (type === 'white') {
        for (let i = 0; i < bufferSize; i++) {
          output[i] = (Math.random() * 2 - 1) * 0.18;
        }
      } else if (type === 'rain') {
        for (let i = 0; i < bufferSize; i++) {
          output[i] = (Math.random() * 2 - 1) * 0.25;
        }
      }

      const source = audioCtx.createBufferSource();
      source.buffer = noiseBuffer;
      source.loop = true;

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = type === 'rain' ? 1100 : (type === 'white' ? 4500 : (type === 'pink' ? 2200 : 650));

      const gain = audioCtx.createGain();
      gain.gain.value = ch.volume * 0.35;

      source.connect(filter).connect(gain).connect(audioCtx.destination);
      source.start();

      ch.source = source;
      ch.gain = gain;
      ch.active = true;

      const btn = document.getElementById(`mixBtn-${type}`);
      if (btn) {
        btn.classList.add('active');
        btn.textContent = 'Ativo';
      }
    }

    function stopMixChannel(type) {
      const ch = mixChannels[type];
      if (!ch) return;
      if (ch.source) {
        try { ch.source.stop(); } catch {}
        try { ch.source.disconnect(); } catch {}
      }
      ch.source = null;
      ch.gain = null;
      ch.active = false;

      const btn = document.getElementById(`mixBtn-${type}`);
      if (btn) {
        btn.classList.remove('active');
        btn.textContent = 'Ligar';
      }
    }

    function setMixChannelVolume(type, val) {
      const ch = mixChannels[type];
      if (!ch) return;
      ch.volume = Number(val) / 100;
      const lbl = document.getElementById(`mixVolLabel-${type}`);
      if (lbl) lbl.textContent = `${val}%`;
      if (ch.gain) {
        ch.gain.gain.value = ch.volume * 0.35;
      }
    }

    function toggleProceduralLofi() {
      if (lofiState.active) stopProceduralLofi();
      else startProceduralLofi();
    }

    function startProceduralLofi() {
      stopProceduralLofi();
      ensureAudioContext();
      lofiState.active = true;
      const btn = document.getElementById('mixBtn-lofi');
      if (btn) { btn.classList.add('active'); btn.textContent = 'Ativo'; }

      const chords = [
        [220.00, 261.63, 329.63, 392.00],
        [174.61, 220.00, 261.63, 349.23],
        [196.00, 246.94, 293.66, 392.00],
        [164.81, 196.00, 246.94, 293.66]
      ];
      let chordIdx = 0;

      const playLofiChord = () => {
        if (!lofiState.active) return;
        const notes = chords[chordIdx % chords.length];
        chordIdx++;
        const now = audioCtx.currentTime;

        notes.forEach((freq, i) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          const filter = audioCtx.createBiquadFilter();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq + (Math.random() * 0.8 - 0.4), now + i * 0.12);
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(600, now);

          const peak = lofiState.volume * 0.06;
          gain.gain.setValueAtTime(0.0001, now + i * 0.12);
          gain.gain.linearRampToValueAtTime(peak, now + i * 0.12 + 0.6);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.4);

          osc.connect(filter).connect(gain).connect(audioCtx.destination);
          osc.start(now + i * 0.12);
          osc.stop(now + 3.5);
        });
      };

      playLofiChord();
      lofiState.interval = setInterval(playLofiChord, 3500);
    }

    function stopProceduralLofi() {
      lofiState.active = false;
      clearInterval(lofiState.interval);
      lofiState.interval = null;
      const btn = document.getElementById('mixBtn-lofi');
      if (btn) { btn.classList.remove('active'); btn.textContent = 'Ligar'; }
    }

    function setProceduralLofiVolume(val) {
      lofiState.volume = Number(val) / 100;
      const lbl = document.getElementById('mixVolLabel-lofi');
      if (lbl) lbl.textContent = `${val}%`;
    }

    function stopAllAmbientSounds() {
      ['brown', 'pink', 'white', 'rain'].forEach(t => stopMixChannel(t));
      stopProceduralLofi();
    }

    // =========================================================================
    // SISTEMA DE FLASHCARDS COM REPETIÇÃO ESPAÇADA
    // =========================================================================
    let currentDueFlashcards = [];
    let currentFlashcardIndex = 0;
    let isFlashcardFlipped = false;

    function handleCreateFlashcard(e) {
      e.preventDefault();
      const subjectId = document.getElementById('fcSubjectSelect').value;
      const front = document.getElementById('fcFrontInput').value.trim();
      const back = document.getElementById('fcBackInput').value.trim();
      if (!front || !back) return;

      if (!Array.isArray(appState.flashcards)) appState.flashcards = [];
      appState.flashcards.push({
        id: 'fc_' + Date.now(),
        subjectId,
        front,
        back,
        nextReview: getLocalDateStr(),
        reviewsCount: 0
      });

      document.getElementById('fcFrontInput').value = '';
      document.getElementById('fcBackInput').value = '';
      saveState();
      renderFlashcardsTab();
    }

    function deleteFlashcard(fcId) {
      undoable('Flashcard excluído.', () => {
        appState.flashcards = (appState.flashcards || []).filter(c => c.id !== fcId);
      });
      renderFlashcardsTab();
    }

    function renderFlashcardsTab() {
      if (!Array.isArray(appState.flashcards)) appState.flashcards = [];

      const subOpts = appState.subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
      const fcSel = document.getElementById('fcSubjectSelect');
      if (fcSel) fcSel.innerHTML = subOpts || `<option value="">Cadastre uma matéria</option>`;

      const filterEl = document.getElementById('fcFilterSubject');
      const prevFilter = filterEl ? filterEl.value : 'all';
      if (filterEl) {
        filterEl.innerHTML = `<option value="all">Todas as Matérias</option>` + subOpts;
        if (prevFilter) filterEl.value = prevFilter;
      }

      document.getElementById('fcTotalBadge').textContent = appState.flashcards.length;

      const listEl = document.getElementById('fcManageList');
      if (appState.flashcards.length === 0) {
        listEl.innerHTML = `<small class="text-secondary text-center py-3">Nenhum flashcard criado.</small>`;
      } else {
        listEl.innerHTML = appState.flashcards.map(c => {
          const sub = appState.subjects.find(s => s.id === c.subjectId);
          return `
            <div class="p-2 d-flex justify-content-between align-items-center" style="background:var(--surface-inset); border:1px solid var(--border-subtle); border-radius:var(--radius-sm);">
              <div class="text-truncate pe-2">
                <span class="badge me-1" style="background:${sub?.color || '#f2295b'};">${escapeHtml(sub?.name || 'Geral')}</span>
                <span class="small text-white">${escapeHtml(c.front)}</span>
              </div>
              <button class="btn btn-outline-danger btn-sm py-0 px-2" onclick="deleteFlashcard('${c.id}')"><i class="bi bi-trash"></i></button>
            </div>
          `;
        }).join('');
      }

      const today = getLocalDateStr();
      const activeFilter = filterEl ? filterEl.value : 'all';
      currentDueFlashcards = appState.flashcards.filter(c => {
        const matchSub = activeFilter === 'all' || c.subjectId === activeFilter;
        const isDue = !c.nextReview || c.nextReview <= today;
        return matchSub && isDue;
      });

      currentFlashcardIndex = 0;
      isFlashcardFlipped = false;
      updateFlashcardArenaUI();
    }

    function updateFlashcardArenaUI() {
      const subBadge = document.getElementById('fcCardSubBadge');
      const sideLabel = document.getElementById('fcCardSideLabel');
      const mainText = document.getElementById('fcCardMainText');
      const controls = document.getElementById('fcReviewControls');
      const subtitle = document.getElementById('fcReviewStatusSubtitle');

      if (currentDueFlashcards.length === 0) {
        subBadge.textContent = 'Tudo em dia!';
        sideLabel.textContent = 'REVISÃO CONCLUÍDA';
        mainText.textContent = '🎉 Nenhum flashcard pendente para hoje!';
        controls.classList.add('d-none');
        subtitle.textContent = '0 cartões pendentes para hoje';
        return;
      }

      const card = currentDueFlashcards[currentFlashcardIndex];
      const sub = appState.subjects.find(s => s.id === card.subjectId);
      subtitle.textContent = `${currentDueFlashcards.length} ${currentDueFlashcards.length === 1 ? 'cartão pendente' : 'cartões pendentes'} hoje`;
      subBadge.textContent = sub ? sub.name : 'Geral';

      if (!isFlashcardFlipped) {
        sideLabel.textContent = 'PERGUNTA · toque para virar';
        mainText.textContent = card.front;
        controls.classList.add('d-none');
      } else {
        sideLabel.textContent = 'RESPOSTA';
        mainText.textContent = card.back;
        controls.classList.remove('d-none');
        [0, 3, 4, 5].forEach(q => {
          const el = document.getElementById(`fcNext${q}`);
          if (el) el.textContent = describeInterval(sm2Next(card, q).interval);
        });
      }
    }

    // Atalhos na aba Flashcards: Espaço vira, 1-4 avaliam
    document.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.querySelector('.modal.show')) return;
      if (!document.getElementById('tab-flashcards')?.classList.contains('active')) return;
      if (e.code === 'Space') { e.preventDefault(); flipCurrentFlashcard(); return; }
      const map = { Digit1: 0, Digit2: 3, Digit3: 4, Digit4: 5, Numpad1: 0, Numpad2: 3, Numpad3: 4, Numpad4: 5 };
      if (isFlashcardFlipped && e.code in map) { e.preventDefault(); rateCurrentFlashcard(map[e.code]); }
    });

    function flipCurrentFlashcard() {
      if (currentDueFlashcards.length === 0) return;
      isFlashcardFlipped = !isFlashcardFlipped;
      updateFlashcardArenaUI();
    }

    // ---------- Repetição espaçada (SM-2 simplificado) ----------
    // Notas: 0 = Errei, 3 = Difícil, 4 = Bom, 5 = Fácil
    function sm2Next(card, q) {
      let ef = Number(card.ef) || 2.5;
      let reps = Number(card.reps) || 0;
      let interval = Number(card.interval) || 0;
      if (q < 3) {
        reps = 0;
        interval = 0; // volta ainda hoje
      } else {
        if (reps === 0) interval = q === 3 ? 1 : (q === 4 ? 1 : 3);
        else if (reps === 1) interval = q === 3 ? 3 : (q === 4 ? 4 : 7);
        else interval = Math.max(1, Math.round(interval * ef * (q === 3 ? 0.8 : q === 5 ? 1.3 : 1)));
        reps += 1;
      }
      ef = Math.max(1.3, ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
      return { ef: Math.round(ef * 100) / 100, reps, interval };
    }

    function describeInterval(days) {
      if (days <= 0) return 'hoje';
      if (days === 1) return '1 dia';
      if (days < 30) return `${days} dias`;
      const months = Math.round(days / 30);
      return months === 1 ? '1 mês' : `${months} meses`;
    }

    function rateCurrentFlashcard(q) {
      if (currentDueFlashcards.length === 0) return;
      const card = currentDueFlashcards[currentFlashcardIndex];
      const target = appState.flashcards.find(c => c.id === card.id);
      if (target) {
        const next = sm2Next(target, Number(q));
        Object.assign(target, next);
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + next.interval);
        target.nextReview = getLocalDateStr(nextDate);
        target.reviewsCount = (Number(target.reviewsCount) || 0) + 1;
        target.lastReview = getLocalDateStr();
      }
      // Tira da fila; se errou, volta para o fim da fila de hoje
      currentDueFlashcards.splice(currentFlashcardIndex, 1);
      if (Number(q) < 3 && target) currentDueFlashcards.push(target);
      if (currentFlashcardIndex >= currentDueFlashcards.length) currentFlashcardIndex = 0;
      isFlashcardFlipped = false;
      saveState();
      updateFlashcardArenaUI();
      document.getElementById('fcTotalBadge').textContent = appState.flashcards.length;
    }

    // Cria um flashcard a partir da anotação aberta (usa o texto selecionado como resposta)
    async function createFlashcardFromNote() {
      const { subId, unitId, lessonId } = currentNoteTarget;
      const sub = appState.subjects.find(s => s.id === subId);
      const lesson = sub?.units.find(u => u.id === unitId)?.lessons.find(l => l.id === lessonId);
      if (!sub || !lesson) return;
      const selected = aceEditorInstance ? aceEditorInstance.getSelectedText().trim() : '';
      const vals = await uiForm({
        title: 'Novo flashcard',
        message: selected ? 'O trecho selecionado virou a resposta. Escreva a pergunta.' : 'Dica: selecione um trecho da anotação antes para preencher a resposta.',
        okLabel: 'Criar flashcard',
        fields: [
          { name: 'front', label: 'Pergunta (frente)', type: 'text', value: '', placeholder: `Ex: O que é ... ? (${lesson.name})` },
          { name: 'back', label: 'Resposta (verso)', type: 'textarea', rows: 4, value: selected }
        ],
        validate: v => (!v.front.trim() ? 'Escreva a pergunta.' : !v.back.trim() ? 'Escreva a resposta.' : '')
      });
      if (!vals) return;
      appState.flashcards.push({
        id: 'fc_' + Date.now(),
        subjectId: sub.id,
        front: vals.front.trim(),
        back: vals.back.trim(),
        source: lesson.name,
        nextReview: getLocalDateStr(),
        reviewsCount: 0, ef: 2.5, reps: 0, interval: 0
      });
      saveState();
      uiToast('Flashcard criado. Ele aparece na revisão de hoje.', { type: 'success' });
    }

    // =========================================================================
    // MODO MICRO-ESTUDO 10 MINUTOS
    // =========================================================================
    const MICRO_TOTAL = 10 * 60;
    let microSecondsLeft = MICRO_TOTAL;
    let microInterval = null;
    let microTargetEndTime = null;
    let microChallengeSubId = '';

    function openMicroStudyModal() {
      stopMicroTimer();
      microSecondsLeft = MICRO_TOTAL;
      updateMicroTimerUI();
      pickRandomMicroChallenge();
      bootstrap.Modal.getOrCreateInstance(document.getElementById('microStudyModal')).show();
    }

    function updateMicroTimerUI() {
      const m = String(Math.floor(microSecondsLeft / 60)).padStart(2, '0');
      const s = String(microSecondsLeft % 60).padStart(2, '0');
      const el = document.getElementById('microTimerDisplay');
      if (el) el.textContent = `${m}:${s}`;
      const elapsedMin = Math.floor((MICRO_TOTAL - microSecondsLeft) / 60);
      const finishBtn = document.getElementById('btnMicroFinish');
      if (finishBtn) {
        finishBtn.disabled = elapsedMin < 1;
        finishBtn.textContent = elapsedMin < 1 ? 'Concluir (mín. 1 min)' : `Concluir ${elapsedMin} min (+${elapsedMin * 2} XP)`;
      }
    }

    function toggleMicroTimer() {
      const btn = document.getElementById('btnMicroStart');
      if (microInterval) {
        stopMicroTimer();
        if (btn) btn.textContent = 'Continuar';
        return;
      }
      if (btn) btn.textContent = 'Pausar';
      microTargetEndTime = Date.now() + microSecondsLeft * 1000;
      microInterval = setInterval(microTick, 1000);
    }

    function microTick() {
      if (!microTargetEndTime) return;
      microSecondsLeft = Math.max(0, Math.round((microTargetEndTime - Date.now()) / 1000));
      updateMicroTimerUI();
      if (microSecondsLeft <= 0) {
        stopMicroTimer();
        playFinishBeep();
        finishMicroStudySession();
      }
    }

    function stopMicroTimer() {
      clearInterval(microInterval);
      microInterval = null;
      microTargetEndTime = null;
      const btn = document.getElementById('btnMicroStart');
      if (btn) btn.textContent = microSecondsLeft < MICRO_TOTAL && microSecondsLeft > 0 ? 'Continuar' : 'Iniciar 10 min';
    }

    function pickRandomMicroChallenge() {
      const box = document.getElementById('microChallengeCard');
      if (!box) return;

      const pendingLessons = [];
      appState.subjects.forEach(s => {
        s.units.forEach(u => {
          u.lessons.forEach(l => {
            if (!l.done) pendingLessons.push({ subId: s.id, sub: s.name, unit: u.name, lesson: l.name });
          });
        });
      });

      const cards = appState.flashcards || [];
      if (cards.length > 0 && Math.random() < 0.5) {
        const randCard = cards[Math.floor(Math.random() * cards.length)];
        const sub = appState.subjects.find(s => s.id === randCard.subjectId);
        microChallengeSubId = sub?.id || '';
        box.innerHTML = `
          <span class="badge mb-2" style="background:var(--accent);">Flashcard • ${escapeHtml(sub?.name || 'Estudo')}</span>
          <h6 class="fw-bold text-white mb-2">${escapeHtml(randCard.front)}</h6>
          <details class="small">
            <summary style="cursor:pointer;">Ver resposta</summary>
            <div class="mt-2 p-2 panel text-white">${escapeHtml(randCard.back)}</div>
          </details>
        `;
      } else if (pendingLessons.length > 0) {
        const randL = pendingLessons[Math.floor(Math.random() * pendingLessons.length)];
        microChallengeSubId = randL.subId;
        box.innerHTML = `
          <span class="badge bg-info text-dark mb-2">Aula pendente</span>
          <h6 class="fw-bold text-white mb-1">${escapeHtml(randL.sub)} — ${escapeHtml(randL.unit)}</h6>
          <p class="small text-secondary mb-0">Foque 10 minutos em: <strong class="text-white">${escapeHtml(randL.lesson)}</strong></p>
        `;
      } else {
        microChallengeSubId = '';
        box.innerHTML = `<div class="text-secondary small">Revise seus Prompts e Fórmulas das matérias durante estes 10 minutos!</div>`;
      }
    }

    function finishMicroStudySession() {
      const elapsedMin = Math.floor((MICRO_TOTAL - microSecondsLeft) / 60);
      if (elapsedMin < 1) {
        uiToast('Estude pelo menos 1 minuto para registrar.', { type: 'warning' });
        return;
      }
      stopMicroTimer();
      const subId = microChallengeSubId || document.getElementById('pomoSubjectSelect')?.value || appState.subjects[0]?.id || '';
      const sub = appState.subjects.find(s => s.id === subId);
      if (sub) sub.minutesStudied = (Number(sub.minutesStudied) || 0) + elapsedMin;

      appState.sessions.unshift({
        id: 'sess_' + Date.now(),
        date: getLocalDateStr(),
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        subjectId: sub ? sub.id : '',
        minutes: elapsedMin,
        note: 'Micro-estudo'
      });

      microSecondsLeft = MICRO_TOTAL;
      bootstrap.Modal.getInstance(document.getElementById('microStudyModal'))?.hide();
      saveState();
      refreshCharts();
      uiToast(`Micro-estudo de ${elapsedMin} min registrado${sub ? ` em ${sub.name}` : ''}.`, { type: 'success' });
    }

    // =========================================================================

    // LABORATÓRIO: 1. GERADOR DE TABELAS-VERDADE
    // =========================================================================
    function insertTTToken(token) {
      const inp = document.getElementById('ttExprInput');
      if (!inp) return;
      inp.value += token;
      inp.focus();
    }

    // Parser de lógica proposicional (descida recursiva).
    // Precedência (da mais forte para a mais fraca): ~  >  ^  >  v  >  ->  >  <->
    // "->" é associativo à direita: P -> Q -> R = P -> (Q -> R)
    function tokenizeProposition(expr) {
      const tokens = [];
      const s = expr.replace(/\s+/g, ' ');
      let i = 0;
      while (i < s.length) {
        const ch = s[i];
        if (ch === ' ') { i++; continue; }
        if (s.startsWith('<->', i)) { tokens.push('<->'); i += 3; continue; }
        if (s.startsWith('->', i)) { tokens.push('->'); i += 2; continue; }
        if (ch === '↔') { tokens.push('<->'); i++; continue; }
        if (ch === '→') { tokens.push('->'); i++; continue; }
        if (ch === '~' || ch === '!' || ch === '¬') { tokens.push('~'); i++; continue; }
        if (ch === '^' || ch === '&' || ch === '∧') { tokens.push('^'); i++; continue; }
        if (ch === '|' || ch === '∨') { tokens.push('v'); i++; continue; }
        if (ch === '(' || ch === ')') { tokens.push(ch); i++; continue; }
        if (/[A-Za-z]/.test(ch)) {
          const up = ch.toUpperCase();
          // "v" sozinho é o operador OU
          if (up === 'V' && !/[A-Za-z0-9]/.test(s[i + 1] || '')) { tokens.push('v'); i++; continue; }
          if (/[A-Za-z0-9]/.test(s[i + 1] || '')) throw new Error(`Use variáveis de uma letra só (encontrei "${s.slice(i, i + 3)}...").`);
          tokens.push({ v: up }); i++; continue;
        }
        throw new Error(`Símbolo não reconhecido: "${ch}"`);
      }
      return tokens;
    }

    function parseProposition(expr) {
      const tokens = tokenizeProposition(expr);
      let pos = 0;
      const peek = () => tokens[pos];
      const take = (t) => { if (peek() === t) { pos++; return true; } return false; };

      function parseBicond() {
        let left = parseImpl();
        while (take('<->')) { const right = parseImpl(); const l = left; left = { op: 'iff', a: l, b: right }; }
        return left;
      }
      function parseImpl() {
        const left = parseOr();
        if (take('->')) return { op: 'imp', a: left, b: parseImpl() };
        return left;
      }
      function parseOr() {
        let left = parseAnd();
        while (take('v')) left = { op: 'or', a: left, b: parseAnd() };
        return left;
      }
      function parseAnd() {
        let left = parseNot();
        while (take('^')) left = { op: 'and', a: left, b: parseNot() };
        return left;
      }
      function parseNot() {
        if (take('~')) return { op: 'not', a: parseNot() };
        return parseAtom();
      }
      function parseAtom() {
        const t = peek();
        if (t === '(') {
          pos++;
          const inner = parseBicond();
          if (!take(')')) throw new Error('Falta fechar um parêntese ")".');
          return inner;
        }
        if (t && typeof t === 'object') { pos++; return { op: 'var', name: t.v }; }
        if (t === undefined) throw new Error('A expressão terminou antes do esperado.');
        throw new Error(`Operador "${t}" fora do lugar.`);
      }

      if (tokens.length === 0) throw new Error('Digite uma expressão.');
      const ast = parseBicond();
      if (pos < tokens.length) throw new Error(peek() === ')' ? 'Há um ")" sobrando.' : 'Faltou um operador entre duas partes.');
      const vars = [...new Set(tokens.filter(t => typeof t === 'object').map(t => t.v))].sort();
      return { ast, vars };
    }

    function evalPropositionAst(node, env) {
      switch (node.op) {
        case 'var': return Boolean(env[node.name]);
        case 'not': return !evalPropositionAst(node.a, env);
        case 'and': return evalPropositionAst(node.a, env) && evalPropositionAst(node.b, env);
        case 'or': return evalPropositionAst(node.a, env) || evalPropositionAst(node.b, env);
        case 'imp': return !evalPropositionAst(node.a, env) || evalPropositionAst(node.b, env);
        case 'iff': return evalPropositionAst(node.a, env) === evalPropositionAst(node.b, env);
      }
      throw new Error('Nó inválido');
    }

    // Mantido com o mesmo nome por compatibilidade
    function evaluatePropositionalFormula(expr, env) {
      return evalPropositionAst(parseProposition(expr).ast, env);
    }

    function generateTruthTable() {
      const raw = document.getElementById('ttExprInput').value.trim();
      const container = document.getElementById('ttOutputContainer');
      const badgeEl = document.getElementById('ttClassificationBadge');
      if (!raw) return;

      let parsed;
      try {
        parsed = parseProposition(raw);
      } catch (err) {
        badgeEl.innerHTML = '';
        container.innerHTML = `<div class="text-danger small">${escapeHtml(err.message)} Exemplo válido: <code>(P ^ Q) -> ~R</code></div>`;
        return;
      }

      const { ast, vars } = parsed;
      if (vars.length === 0 || vars.length > 6) {
        container.innerHTML = `<div class="text-warning small">Use de 1 a 6 variáveis (ex: P, Q, R). A letra V é reservada para o OU.</div>`;
        badgeEl.innerHTML = '';
        return;
      }

      const numRows = Math.pow(2, vars.length);
      let trueCount = 0;
      let rowsHtml = '';
      for (let i = numRows - 1; i >= 0; i--) {
        const env = {};
        vars.forEach((v, idx) => { env[v] = Boolean((i >> (vars.length - 1 - idx)) & 1); });
        const res = evalPropositionAst(ast, env);
        if (res) trueCount++;
        const cells = vars.map(v => `<td class="${env[v] ? 'text-info fw-bold' : 'text-secondary'}">${env[v] ? 'V' : 'F'}</td>`).join('');
        rowsHtml += `<tr>${cells}<td class="fw-bold ${res ? 'text-success' : 'text-danger'}">${res ? 'V' : 'F'}</td></tr>`;
      }

      if (trueCount === numRows) {
        badgeEl.innerHTML = `<span class="badge bg-success">Tautologia (sempre verdadeira)</span>`;
      } else if (trueCount === 0) {
        badgeEl.innerHTML = `<span class="badge bg-danger">Contradição (sempre falsa)</span>`;
      } else {
        badgeEl.innerHTML = `<span class="badge bg-info text-dark">Contingência (${trueCount} V / ${numRows - trueCount} F)</span>`;
      }

      container.innerHTML = `
        <table class="table table-dark table-sm table-bordered text-center align-middle mb-0 font-monospace">
          <thead>
            <tr class="text-secondary">
              ${vars.map(v => `<th>${v}</th>`).join('')}
              <th class="text-info">${escapeHtml(raw)}</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      `;
    }

    // =========================================================================
    // LABORATÓRIO: 2. CONVERSOR DE BASES & CALCULADORA BITWISE
    // =========================================================================
    const BASE_RULES = {
      dec: { radix: 10n, re: /^[0-9]+$/, name: 'decimal', digits: '0 a 9' },
      bin: { radix: 2n, re: /^[01]+$/, name: 'binário', digits: '0 e 1' },
      hex: { radix: 16n, re: /^[0-9a-f]+$/i, name: 'hexadecimal', digits: '0 a 9 e A a F' },
      oct: { radix: 8n, re: /^[0-7]+$/, name: 'octal', digits: '0 a 7' }
    };
    const BASE_INPUT_IDS = { dec: 'baseDec', bin: 'baseBin', hex: 'baseHex', oct: 'baseOct' };

    function parseBigIntInBase(str, radix) {
      let n = 0n;
      for (const ch of str.toLowerCase()) n = n * radix + BigInt(parseInt(ch, 36));
      return n;
    }

    function handleBaseConversion(sourceBase, rawVal) {
      const val = rawVal.trim().replace(/^0[xbo]/i, '').replace(/[\s_]/g, '');
      const msgEl = document.getElementById('baseConvMsg');
      const setMsg = (t) => { if (msgEl) { msgEl.textContent = t; msgEl.classList.toggle('d-none', !t); } };
      Object.entries(BASE_INPUT_IDS).forEach(([k, id]) => document.getElementById(id).classList.remove('is-invalid'));

      if (!val) {
        Object.entries(BASE_INPUT_IDS).forEach(([k, id]) => { if (k !== sourceBase) document.getElementById(id).value = ''; });
        setMsg('');
        return;
      }

      const rule = BASE_RULES[sourceBase];
      if (!rule.re.test(val)) {
        document.getElementById(BASE_INPUT_IDS[sourceBase]).classList.add('is-invalid');
        Object.entries(BASE_INPUT_IDS).forEach(([k, id]) => { if (k !== sourceBase) document.getElementById(id).value = ''; });
        setMsg(`Valor inválido em ${rule.name}: use apenas ${rule.digits}.`);
        return;
      }

      const num = parseBigIntInBase(val, rule.radix);
      setMsg('');
      if (sourceBase !== 'dec') document.getElementById('baseDec').value = num.toString(10);
      if (sourceBase !== 'bin') document.getElementById('baseBin').value = num.toString(2);
      if (sourceBase !== 'hex') document.getElementById('baseHex').value = num.toString(16).toUpperCase();
      if (sourceBase !== 'oct') document.getElementById('baseOct').value = num.toString(8);
    }

    function calcBitwise() {
      const a = parseInt(document.getElementById('bwA')?.value || '0', 10) || 0;
      const b = parseInt(document.getElementById('bwB')?.value || '0', 10) || 0;
      const op = document.getElementById('bwOp')?.value || 'AND';

      let res = 0;
      if (op === 'AND') res = a & b;
      else if (op === 'OR') res = a | b;
      else if (op === 'XOR') res = a ^ b;
      else if (op === 'LSHIFT') res = a << b;
      else if (op === 'RSHIFT') res = a >> b;
      else if (op === 'NOT') res = ~a;

      // Mostra 8 bits quando cabe; senão os 32 bits do inteiro (complemento de dois)
      const fits8 = res >= -128 && res <= 255;
      const bits = fits8 ? 8 : 32;
      const unsigned = fits8 ? (res & 0xff) : (res >>> 0);
      const box = document.getElementById('bwResultBox');
      if (box) {
        box.innerHTML = `
          <div>Resultado decimal: <strong class="text-info">${res}</strong></div>
          <div>Binário (${bits} bits${res < 0 ? ', complemento de dois' : ''}): <strong class="text-warning">${unsigned.toString(2).padStart(bits, '0')}</strong> · Hex: <strong class="text-success">0x${unsigned.toString(16).toUpperCase()}</strong></div>
        `;
      }
    }

    // =========================================================================
    // LABORATÓRIO: 3. TERMINAL PYTHON NO NAVEGADOR VIA PYODIDE
    // =========================================================================
    let pyAceEditor = null;
    let pyodideInstance = null;
    let pyodideLoading = false;

    function clearPythonOutput() {
      const out = document.getElementById('pyConsoleOutput');
      if (out) out.textContent = '';
    }

    async function runBrowserPython() {
      const out = document.getElementById('pyConsoleOutput');
      const btn = document.getElementById('btnRunPython');
      const code = pyAceEditor ? pyAceEditor.getValue() : '';
      if (!code.trim()) return;

      try {
        btn.disabled = true;
        if (!pyodideInstance) {
          out.textContent = '⏳ Baixando motor Python (Pyodide WebAssembly) pela 1ª vez... Aguarde alguns segundos...\n';
          if (!window.loadPyodide && !pyodideLoading) {
            pyodideLoading = true;
            await new Promise((resolve, reject) => {
              const script = document.createElement('script');
              script.src = 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js';
              script.onload = resolve;
              script.onerror = reject;
              document.head.appendChild(script);
            });
          }
          pyodideInstance = await window.loadPyodide({
            stdout: (msg) => { out.textContent += msg + '\n'; },
            stderr: (msg) => { out.textContent += '[Erro] ' + msg + '\n'; }
          });
          out.textContent = '✅ Python 3 carregado! Executando script:\n----------------------------------------\n';
        } else {
          out.textContent += '\n>>> Executando:\n';
        }

        await pyodideInstance.runPythonAsync(code);
      } catch (err) {
        out.textContent += `\n❌ Erro de Execução:\n${err.message || err}\n`;
      } finally {
        btn.disabled = false;
      }
    }

    // =========================================================================
    // PRAZOS, AGENDA ESTILO "UPCOMING EVENTS ." & KANBAN
    // =========================================================================
    function handleCreateTask(e) {
      e.preventDefault();
      const title = document.getElementById('taskTitle').value.trim();
      const subjectId = document.getElementById('taskSubjectSelect').value;
      const type = document.getElementById('taskType').value;
      const dueDate = document.getElementById('taskDate').value;
      const dueTime = document.getElementById('taskTime').value;
      const estMinutes = Number(document.getElementById('taskEstMins')?.value) || 60;
      if (!title || !dueDate) return;

      appState.tasks.push({
        id: 'task_' + Date.now(),
        title,
        subjectId,
        type,
        dueDate,
        dueTime: dueTime || '',
        estMinutes,
        actualMinutes: 0,
        status: 'todo'
      });

      document.getElementById('taskTitle').value = '';
      saveState();
    }

    function moveTaskStatus(taskId, newStatus) {
      const task = appState.tasks.find(t => t.id === taskId);
      if (task) {
        task.status = newStatus;
        saveState();
      }
    }

    function deleteTask(taskId) {
      const t = appState.tasks.find(x => x.id === taskId);
      if (!t) return;
      undoable(`"${t.title}" excluído.`, () => {
        appState.tasks = appState.tasks.filter(x => x.id !== taskId);
      });
    }

    function getDaysRemainingBadge(dueDateStr, status) {
      if (status === 'done') return `<span class="badge bg-success bg-opacity-25 text-success" >Concluído</span>`;
      const today = new Date(getLocalDateStr() + 'T00:00:00');
      const due = new Date(dueDateStr + 'T00:00:00');
      const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));

      if (diffDays < 0) return `<span class="badge bg-danger" >Atrasado (${Math.abs(diffDays)}d)</span>`;
      if (diffDays === 0) return `<span class="badge bg-danger" >É Hoje!</span>`;
      if (diffDays === 1) return `<span class="badge bg-warning text-dark" >Amanhã!</span>`;
      if (diffDays <= 5) return `<span class="badge bg-warning bg-opacity-25 text-warning" >Faltam ${diffDays} dias</span>`;
      return `<span class="badge bg-secondary bg-opacity-25 text-secondary" >Em ${diffDays} dias</span>`;
    }

    function renderTasks() {
      const cols = { todo: [], doing: [], done: [] };
      const sortedTasks = [...appState.tasks].sort((a, b) => `${a.dueDate} ${a.dueTime || '23:59'}`.localeCompare(`${b.dueDate} ${b.dueTime || '23:59'}`));

      // Renderiza Lista Horizontal Estilo "Upcoming events ." (Lavo)
      const eventsContainer = document.getElementById('upcomingEventsListContainer');
      const pendingEvents = sortedTasks.filter(t => t.status !== 'done');
      if (eventsContainer) {
        if (pendingEvents.length === 0) {
          eventsContainer.innerHTML = `<div class="text-secondary small py-3">Nenhuma entrega ou prova pendente na agenda.</div>`;
        } else {
          eventsContainer.innerHTML = pendingEvents.map(t => {
            const dObj = new Date(t.dueDate + 'T12:00:00');
            const dayNum = String(dObj.getDate()).padStart(2, '0');
            const monthName = dObj.toLocaleDateString('pt-BR', { month: 'long' });
            const weekDay = dObj.toLocaleDateString('pt-BR', { weekday: 'long' });
            const sub = appState.subjects.find(s => s.id === t.subjectId);
            return `
              <div class="event-row">
                <div class="d-flex align-items-center gap-3">
                  <div class="event-day-split">${dayNum}</div>
                  <div>
                    <div class="small text-secondary text-capitalize">${monthName}</div>
                    <div class="small text-muted text-capitalize" style="font-size:0.75rem;">${weekDay}</div>
                  </div>
                </div>
                <div class="flex-grow-1 px-md-3">
                  <h5 class="fw-bold text-white mb-0 display-font">${escapeHtml(t.title)}</h5>
                  <small class="text-info">${t.type} • ${escapeHtml(sub?.name || 'Geral')}</small>
                </div>
                <div class="text-secondary small">
                  ${t.dueTime ? `${t.dueTime} • ` : ''}Est: ${t.estMinutes || 60}m
                </div>
                <div>
                  <button class="btn btn-nexus btn-sm px-4 py-2" onclick="moveTaskStatus('${t.id}', 'done')">
                    CONCLUIR
                  </button>
                </div>
              </div>
            `;
          }).join('');
        }
      }

      appState.tasks.forEach(t => {
        const sub = appState.subjects.find(s => s.id === t.subjectId);
        const subName = sub ? sub.name : 'Geral';
        const subColor = sub ? sub.color : '#00c8ff';
        const est = Number(t.estMinutes) || 60;
        const act = Number(t.actualMinutes) || 0;
        const timeDiffLabel = act > 0 
          ? `<span class="badge bg-dark border border-secondary text-info" >Real: ${act}m / Est: ${est}m</span>`
          : `<span class="badge bg-dark border border-secondary text-secondary" >Est: ${est}m</span>`;

        const cardHtml = `
          <div class="p-3" style="background:var(--surface-2); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); border-left: 3px solid ${subColor};">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-1">
              <span class="fw-bold small">${escapeHtml(t.title)}</span>
              ${getDaysRemainingBadge(t.dueDate, t.status)}
            </div>
            <div class="d-flex justify-content-between align-items-center small text-secondary mb-2">
              <span>${t.type} • ${escapeHtml(subName)}</span>
              ${timeDiffLabel}
            </div>
            <div class="d-flex justify-content-between align-items-center pt-2 border-top border-secondary border-opacity-25">
              <small class="text-secondary" style="font-size:0.75rem;">
                <i class="bi bi-calendar-event me-1"></i>${t.dueDate.split('-').reverse().join('/')}${t.dueTime ? ` às <strong class="text-info">${t.dueTime}</strong>` : ''}
              </small>
              <div class="btn-group btn-group-sm">
                ${t.status !== 'todo' ? `<button class="btn btn-outline-secondary py-0 px-2" onclick="moveTaskStatus('${t.id}','todo')"><i class="bi bi-arrow-left"></i></button>` : ''}
                ${t.status !== 'doing' ? `<button class="btn btn-outline-info py-0 px-2" onclick="moveTaskStatus('${t.id}','doing')"><i class="bi bi-play"></i></button>` : ''}
                ${t.status !== 'done' ? `<button class="btn btn-outline-success py-0 px-2" onclick="moveTaskStatus('${t.id}','done')"><i class="bi bi-check2"></i></button>` : ''}
                <button class="btn btn-outline-danger py-0 px-2" onclick="deleteTask('${t.id}')"><i class="bi bi-x"></i></button>
              </div>
            </div>
          </div>
        `;
        cols[t.status]?.push(cardHtml);
      });

      document.getElementById('kanban-todo').innerHTML = cols.todo.join('') || `<small class="text-secondary">Nenhum item pendente.</small>`;
      document.getElementById('kanban-doing').innerHTML = cols.doing.join('') || `<small class="text-secondary">Nenhum item em andamento.</small>`;
      document.getElementById('kanban-done').innerHTML = cols.done.join('') || `<small class="text-secondary">Nenhum item concluído.</small>`;

      const ganttEl = document.getElementById('semesterGanttContainer');
      if (ganttEl) {
        ganttEl.innerHTML = appState.subjects.map(s => {
          const doneL = s.units.reduce((acc, u) => acc + u.lessons.filter(l => l.done).length, 0);
          const totL = countLessons(s);
          const pct = totL ? Math.round((doneL / totL) * 100) : 0;
          const subTasks = appState.tasks.filter(t => t.subjectId === s.id && t.status !== 'done');
          const nextTaskInfo = subTasks.length > 0 ? `Próxima entrega: ${subTasks[0].title} (${subTasks[0].dueDate.split('-').reverse().join('/')})` : 'Sem entregas pendentes';
          return `
            <div class="p-3" style="background:var(--surface-2); border:1px solid var(--border-subtle); border-radius:var(--radius-sm);">
              <div class="d-flex justify-content-between small mb-2">
                <span class="fw-bold text-white">${escapeHtml(s.name)}</span>
                <span class="text-secondary">${nextTaskInfo} • <strong class="text-info">${pct}% concluído</strong></span>
              </div>
              <div class="progress" style="height: 6px; background:var(--surface-inset);">
                <div class="progress-bar" style="width:${pct}%; background:${s.color};"></div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // =========================================================================
    // DASHBOARD, HEATMAP & GRÁFICOS (PALETA CRIMSON & CYAN)
    // =========================================================================
    let chartWeeklyInst = null;
    let chartSubjectTimeInst = null;
    let chartSubjectGradesInst = null;

    function renderHeatmap() {
      const container = document.getElementById('heatmapContainer');
      const minsByDate = {};
      appState.sessions.forEach(s => {
        minsByDate[s.date] = (minsByDate[s.date] || 0) + Number(s.minutes);
      });

      const activeDaysCount = Object.keys(minsByDate).filter(k => minsByDate[k] > 0).length;
      const summaryEl = document.getElementById('heatmapSummaryText');
      if (summaryEl) {
        summaryEl.textContent = `${activeDaysCount} dias ativos registrados • ${appState.sessions.length} sessões de foco concluídas`;
      }

      const totalDays = 28 * 7;
      const today = new Date();
      const cells = [];

      for (let i = totalDays - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const dateStr = getLocalDateStr(d);
        const mins = minsByDate[dateStr] || 0;

        let levelClass = '';
        if (mins >= 120) levelClass = 'heat-l4';
        else if (mins >= 60) levelClass = 'heat-l3';
        else if (mins >= 25) levelClass = 'heat-l2';
        else if (mins > 0) levelClass = 'heat-l1';

        const formattedDate = d.toLocaleDateString('pt-BR');
        cells.push(`<div class="heat-cell ${levelClass}" title="${formattedDate}: ${mins} min estudados"></div>`);
      }
      container.innerHTML = cells.join('');
    }

    function refreshCharts() {
      if (!appState) return;
      Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
      Chart.defaults.color = '#8b93a1';

      const labels7 = [];
      const data7 = [];
      const today = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const dStr = getLocalDateStr(d);
        labels7.push(d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' }));
        const mins = appState.sessions
          .filter(s => s.date === dStr)
          .reduce((acc, s) => acc + Number(s.minutes), 0);
        data7.push(mins);
      }

      if (chartWeeklyInst) chartWeeklyInst.destroy();
      chartWeeklyInst = new Chart(document.getElementById('chartWeekly'), {
        type: 'bar',
        data: {
          labels: labels7,
          datasets: [{
            label: 'Minutos Estudados',
            data: data7,
            backgroundColor: '#7c83ff',
            borderWidth: 0,
            borderRadius: 6,
            maxBarThickness: 32
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
            x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
          }
        }
      });

      const subNames = appState.subjects.map(s => s.name);
      const subMins = appState.subjects.map(s => s.minutesStudied || 0);
      const subColors = appState.subjects.map(s => s.color);

      if (chartSubjectTimeInst) chartSubjectTimeInst.destroy();
      chartSubjectTimeInst = new Chart(document.getElementById('chartSubjectTime'), {
        type: 'doughnut',
        data: {
          labels: subNames.length ? subNames : ['Sem dados'],
          datasets: [{
            data: subMins.some(m => m > 0) ? subMins : [1],
            backgroundColor: subMins.some(m => m > 0) ? subColors : ['#1c212a'],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '68%',
          plugins: {
            legend: { position: 'bottom', labels: { color: '#cbd5e1', boxWidth: 12, font: { size: 11 } } }
          }
        }
      });

      const unitColors = ['#4f56c9', '#7c83ff', '#a5aaff', '#d0d3ff'];
      const unitDatasets = [0, 1, 2, 3].map(uIdx => ({
        label: `Unidade ${uIdx + 1}`,
        data: appState.subjects.map(s => s.units[uIdx]?.score ?? 0),
        backgroundColor: unitColors[uIdx],
        borderRadius: 4
      }));

      if (chartSubjectGradesInst) chartSubjectGradesInst.destroy();
      chartSubjectGradesInst = new Chart(document.getElementById('chartSubjectGrades'), {
        type: 'bar',
        data: {
          labels: appState.subjects.map(s => s.name.length > 16 ? s.name.slice(0, 16) + '…' : s.name),
          datasets: unitDatasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { color: '#cbd5e1', boxWidth: 10, font: { size: 11 } } }
          },
          scales: {
            y: { min: 0, max: 5, ticks: { stepSize: 1, color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
            x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { display: false } }
          }
        }
      });
    }

    // =========================================================================
    // ATUALIZAÇÃO GERAL DA INTERFACE
    // =========================================================================
    function updateAllUI() {
      const g = calculateGamification();
      document.getElementById('uiLevelBadge').textContent = g.level;
      document.getElementById('uiRankTitle').textContent = g.rank;
      document.getElementById('uiXpText').textContent = `${g.xpInCurrentLevel} / ${g.xpPerLevel} XP (Total: ${g.totalXP})`;
      document.getElementById('uiXpBar').style.width = `${g.progressPct}%`;
      const xpBarMenu = document.getElementById('uiXpBarMenu');
      if (xpBarMenu) xpBarMenu.style.width = `${g.progressPct}%`;

      const streak = calculateStreak();
      document.getElementById('uiStreakCount').textContent = streak;
      updateHydrationUI();

      // Início: "Continuar de onde parou"
      renderHomeContinue(streak);

      const todayStr = getLocalDateStr();
      const todayMins = appState.sessions
        .filter(s => s.date === todayStr)
        .reduce((acc, s) => acc + Number(s.minutes), 0);
      const goal = appState.settings.dailyGoalMinutes || 120;
      document.getElementById('uiTodayMins').textContent = todayMins;
      document.getElementById('uiDailyGoal').textContent = goal;
      document.getElementById('uiDailyGoalBar').style.width = `${Math.min(100, Math.round((todayMins / goal) * 100))}%`;

      const totalMins = appState.sessions.reduce((acc, s) => acc + Number(s.minutes), 0);
      const h = Math.floor(totalMins / 60);
      const m = totalMins % 60;
      document.getElementById('statTotalHours').textContent = `${h}h ${String(m).padStart(2, '0')}m`;

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      const sevenStr = getLocalDateStr(sevenDaysAgo);
      const weekMins = appState.sessions
        .filter(s => s.date >= sevenStr)
        .reduce((acc, s) => acc + Number(s.minutes), 0);
      document.getElementById('statWeekHours').textContent = `${weekMins} min nos últimos 7 dias`;

      let totalLessons = appState.subjects.reduce((acc, s) => acc + countLessons(s), 0);
      let doneLessons = 0;
      let sumScores = 0;
      let scoredUnitsCount = 0;

      appState.subjects.forEach(s => {
        s.units.forEach(u => {
          u.lessons.forEach(l => { if (l.done) doneLessons++; });
          if (u.score !== null && u.score !== undefined) {
            sumScores += Number(u.score);
            scoredUnitsCount++;
          }
        });
      });

      const lessonsPct = totalLessons > 0 ? Math.round((doneLessons / totalLessons) * 100) : 0;
      document.getElementById('statLessonsDone').textContent = `${doneLessons} / ${totalLessons}`;
      document.getElementById('statLessonsPct').textContent = `${lessonsPct}% da grade concluída`;

      const maxQuizPts = scoredUnitsCount * 5;
      const quizPct = maxQuizPts > 0 ? Math.round((sumScores / maxQuizPts) * 100) : 0;
      document.getElementById('statQuizScore').textContent = `${sumScores} / ${maxQuizPts}`;
      document.getElementById('statQuizPct').textContent = `Aproveitamento médio: ${quizPct}%`;

      const pendingTasks = appState.tasks
        .filter(t => t.status !== 'done')
        .sort((a, b) => `${a.dueDate} ${a.dueTime || '23:59'}`.localeCompare(`${b.dueDate} ${b.dueTime || '23:59'}`));
      if (pendingTasks.length > 0) {
        const next = pendingTasks[0];
        const timeTag = next.dueTime ? ` às ${next.dueTime}` : '';
        document.getElementById('statNextDeadlineTitle').textContent = next.title;
        document.getElementById('statNextDeadlineCountdown').innerHTML = `${next.type}${timeTag} • ${getDaysRemainingBadge(next.dueDate, next.status)}`;
        if (next.dueDate < getLocalDateStr()) {
          document.getElementById('statNextDeadlineCountdown').innerHTML +=
            ` <button class="btn btn-link btn-sm p-0 ms-1 align-baseline" onclick="resolveTask('${next.id}')">Já fiz?</button>`;
        }
      } else {
        document.getElementById('statNextDeadlineTitle').textContent = 'Sem prazos pendentes';
        document.getElementById('statNextDeadlineCountdown').textContent = 'Tudo em dia!';
      }

      const optionsHtml = appState.subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
      const pomoSel = document.getElementById('pomoSubjectSelect');
      const prevPomoVal = pomoSel.value;
      pomoSel.innerHTML = optionsHtml || `<option value="">Cadastre uma matéria primeiro</option>`;
      if (prevPomoVal && appState.subjects.some(s => s.id === prevPomoVal)) pomoSel.value = prevPomoVal;

      const pomoTaskSel = document.getElementById('pomoTaskSelect');
      if (pomoTaskSel) {
        const prevTaskVal = pomoTaskSel.value;
        const activeTasksHtml = appState.tasks
          .filter(t => t.status !== 'done')
          .map(t => `<option value="${t.id}">${escapeHtml(t.title)} (Est: ${t.estMinutes || 60}m)</option>`).join('');
        pomoTaskSel.innerHTML = `<option value="">-- Nenhuma tarefa específica --</option>` + activeTasksHtml;
        if (prevTaskVal) pomoTaskSel.value = prevTaskVal;
      }

      const taskSel = document.getElementById('taskSubjectSelect');
      taskSel.innerHTML = `<option value="geral">Geral</option>` + optionsHtml;

      const tbody = document.getElementById('studyLogTableBody');
      if (appState.sessions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-secondary py-3">Nenhuma sessão registrada ainda.</td></tr>`;
      } else {
        const list = showAllSessions ? appState.sessions : appState.sessions.slice(0, 15);
        tbody.innerHTML = list.map(s => {
          const sub = appState.subjects.find(sub => sub.id === s.subjectId);
          return `
            <tr>
              <td class="small text-secondary text-nowrap">${s.date.split('-').reverse().join('/')} ${s.timestamp || ''}</td>
              <td><span class="badge" style="background-color:${sub?.color || '#5d6573'};">${escapeHtml(sub?.name || 'Sem matéria')}</span></td>
              <td class="fw-semibold text-nowrap">${s.minutes} min</td>
              <td class="small">${escapeHtml(s.note || '')}</td>
              <td class="text-end text-nowrap">
                <button class="btn btn-sm btn-outline-nexus px-2 py-0" onclick="editSession('${s.id}')" title="Editar"><i class="bi bi-pencil"></i></button>
                <button class="btn btn-sm btn-outline-danger px-2 py-0" onclick="deleteSession('${s.id}')" title="Excluir"><i class="bi bi-trash"></i></button>
              </td>
            </tr>
          `;
        }).join('') + (appState.sessions.length > 15 ? `
            <tr><td colspan="5" class="text-center"><button class="btn btn-link btn-sm" onclick="toggleAllSessions()">${showAllSessions ? 'Mostrar só as 15 últimas' : `Ver todas (${appState.sessions.length})`}</button></td></tr>` : '');
      }

      renderProductivityMetrics();
      renderHeatmap();
      renderSubjects();
      renderTasks();
      renderBadgesWall();
    }

    // ---------- Início: continuar de onde parou ----------
    function findNextLesson(sub) {
      for (const u of sub.units) {
        const l = u.lessons.find(x => !x.done);
        if (l) return { unit: u, lesson: l };
      }
      return null;
    }

    function pickContinueSubject() {
      const scheduled = getCurrentScheduledSubjectId();
      if (scheduled) return { subId: scheduled, reason: 'scheduled' };
      const lastSess = appState.sessions.find(s => appState.subjects.some(x => x.id === s.subjectId));
      if (lastSess) {
        const sub = appState.subjects.find(x => x.id === lastSess.subjectId);
        if (findNextLesson(sub)) return { subId: sub.id, reason: 'recent' };
      }
      const withPending = appState.subjects.find(s => findNextLesson(s));
      return withPending ? { subId: withPending.id, reason: 'pending' } : null;
    }

    function renderHomeContinue(streak) {
      const eyebrow = document.getElementById('heroEyebrow');
      const headline = document.getElementById('heroBannerHeadline');
      const subtext = document.getElementById('heroBannerSubtext');
      const actions = document.getElementById('heroActions');
      if (!headline || !actions) return;
      const streakTxt = `${streak} ${streak === 1 ? 'dia seguido' : 'dias seguidos'}`;

      if (!appState.subjects.length) {
        eyebrow.textContent = 'Bem-vindo';
        headline.textContent = 'Cadastre sua primeira matéria';
        subtext.textContent = 'Depois é só começar o foco por aqui.';
        actions.innerHTML = `<button class="btn btn-nexus btn-lg px-4" onclick="switchMobileTab('#tab-subjects')"><i class="bi bi-plus-lg me-1"></i> Nova matéria</button>`;
        return;
      }

      const pick = pickContinueSubject();
      if (!pick) {
        eyebrow.textContent = 'Parabéns';
        headline.textContent = 'Todas as aulas concluídas 🎉';
        subtext.textContent = `${streakTxt} · aproveite para revisar com flashcards`;
        actions.innerHTML = `<button class="btn btn-nexus btn-lg px-4" onclick="switchMobileTab('#tab-flashcards')"><i class="bi bi-collection me-1"></i> Revisar</button>`;
        return;
      }

      const sub = appState.subjects.find(s => s.id === pick.subId);
      const next = findNextLesson(sub);
      const labels = { scheduled: 'No cronograma de agora', recent: 'Continuar de onde parou', pending: 'Sugestão para agora' };
      eyebrow.textContent = labels[pick.reason];
      headline.textContent = sub.name;
      subtext.textContent = next
        ? `Próxima: ${next.unit.name} · ${next.lesson.name} — ${streakTxt}`
        : `Todas as aulas desta matéria estão concluídas — ${streakTxt}`;
      actions.innerHTML = `
        <button class="btn btn-nexus btn-lg px-4" onclick="startFocusForSubject('${sub.id}')"><i class="bi bi-play-fill me-1"></i> Começar foco</button>
        ${next ? `
          <button class="btn btn-outline-nexus" onclick="completeLessonFromHome('${sub.id}', '${next.unit.id}', '${next.lesson.id}')" title="Marcar a próxima aula como concluída"><i class="bi bi-check2"></i> Concluí a aula</button>
          <button class="btn btn-outline-nexus" onclick="openLessonNoteModal('${sub.id}', '${next.unit.id}', '${next.lesson.id}')" title="Anotações da aula"><i class="bi bi-journal-text"></i></button>` : ''}`;
    }

    function completeLessonFromHome(subId, unitId, lessonId) {
      const sub = appState.subjects.find(s => s.id === subId);
      const lesson = sub?.units.find(u => u.id === unitId)?.lessons.find(l => l.id === lessonId);
      if (!lesson) return;
      undoable(`"${lesson.name}" concluída (+25 XP).`, () => { lesson.done = true; });
    }

    // ---------- Prazos vencidos: marcar como feito e lançar a nota ----------
    async function resolveTask(taskId) {
      const t = appState.tasks.find(x => x.id === taskId);
      if (!t) return;
      const vals = await uiForm({
        title: t.title,
        message: `Era para ${t.dueDate.split('-').reverse().join('/')}. Já foi feito?`,
        okLabel: 'Salvar',
        fields: [
          { name: 'grade', label: 'Nota (opcional)', type: 'text', placeholder: 'Ex: 8,5 ou 9/10', value: t.grade || '' },
          { name: 'newDate', label: 'Ainda não fiz — adiar para', type: 'date', value: '', hint: 'Deixe vazio para marcar como feito.' }
        ]
      });
      if (!vals) return;
      if (vals.newDate) {
        t.dueDate = vals.newDate;
        saveState();
        uiToast('Prazo adiado.', { type: 'success' });
        return;
      }
      t.status = 'done';
      if (vals.grade.trim()) t.grade = vals.grade.trim();
      saveState();
      uiToast(`"${t.title}" concluído (+50 XP).`, { type: 'success' });
    }

    // ---------- Histórico de sessões: editar e excluir ----------
    async function editSession(sessionId) {
      const s = appState.sessions.find(x => x.id === sessionId);
      if (!s) return;
      const vals = await uiForm({
        title: 'Editar sessão',
        okLabel: 'Salvar',
        fields: [
          { name: 'subjectId', label: 'Matéria', type: 'select', value: s.subjectId,
            options: [{ value: '', label: 'Sem matéria' }, ...appState.subjects.map(x => ({ value: x.id, label: x.name }))] },
          { name: 'date', label: 'Data', type: 'date', value: s.date },
          { name: 'minutes', label: 'Minutos', type: 'number', min: 1, max: 600, step: 1, value: s.minutes },
          { name: 'note', label: 'O que foi estudado', type: 'text', value: s.note || '' }
        ],
        validate: v => {
          if (!v.date) return 'Escolha uma data.';
          if (!(Number(v.minutes) >= 1 && Number(v.minutes) <= 600)) return 'Os minutos devem ficar entre 1 e 600.';
          return '';
        }
      });
      if (!vals) return;
      const oldSub = appState.subjects.find(x => x.id === s.subjectId);
      if (oldSub) oldSub.minutesStudied = Math.max(0, (Number(oldSub.minutesStudied) || 0) - (Number(s.minutes) || 0));
      s.subjectId = vals.subjectId;
      s.date = vals.date;
      s.minutes = Math.round(Number(vals.minutes));
      s.note = vals.note.trim();
      const newSub = appState.subjects.find(x => x.id === s.subjectId);
      if (newSub) newSub.minutesStudied = (Number(newSub.minutesStudied) || 0) + s.minutes;
      appState.sessions.sort((a, b) => `${b.date} ${b.timestamp || ''}`.localeCompare(`${a.date} ${a.timestamp || ''}`));
      saveState();
      refreshCharts();
      uiToast('Sessão atualizada.', { type: 'success' });
    }

    function deleteSession(sessionId) {
      const s = appState.sessions.find(x => x.id === sessionId);
      if (!s) return;
      undoable(`Sessão de ${s.minutes} min excluída.`, () => {
        const sub = appState.subjects.find(x => x.id === s.subjectId);
        if (sub) sub.minutesStudied = Math.max(0, (Number(sub.minutesStudied) || 0) - (Number(s.minutes) || 0));
        appState.sessions = appState.sessions.filter(x => x.id !== sessionId);
      });
    }

    let showAllSessions = false;
    function toggleAllSessions() { showAllSessions = !showAllSessions; updateAllUI(); }

    // =========================================================================
    // SISTEMA DE ANOTAÇÕES POR AULA COM ACE EDITOR (ESTILO VS CODE)
    // =========================================================================
    let currentNoteTarget = { subId: null, unitId: null, lessonId: null };
    let aceEditorInstance = null;

    function openLessonNoteModal(subId, unitId, lessonId) {
      const sub = appState.subjects.find(s => s.id === subId);
      const unit = sub?.units.find(u => u.id === unitId);
      const lesson = unit?.lessons.find(l => l.id === lessonId);
      if (!lesson) return;

      currentNoteTarget = { subId, unitId, lessonId };
      document.getElementById('modalNoteTitle').innerHTML = `Anotações: ${escapeHtml(sub.name)} &gt; ${escapeHtml(unit.name)} &gt; ${escapeHtml(lesson.name)}`;
      
      const modal = new bootstrap.Modal(document.getElementById('lessonNoteModal'));
      modal.show();

      setTimeout(() => {
        if (aceEditorInstance) {
          aceEditorInstance.setValue(lesson.note || '', -1);
          aceEditorInstance.resize();
          aceEditorInstance.focus();
        }
      }, 200);
    }

    function saveCurrentLessonNote() {
      const { subId, unitId, lessonId } = currentNoteTarget;
      const sub = appState.subjects.find(s => s.id === subId);
      const unit = sub?.units.find(u => u.id === unitId);
      const lesson = unit?.lessons.find(l => l.id === lessonId);

      if (lesson && aceEditorInstance) {
        lesson.note = aceEditorInstance.getValue().trim();
        saveState();
        const modalEl = document.getElementById('lessonNoteModal');
        bootstrap.Modal.getInstance(modalEl).hide();
      }
    }

    // =========================================================================
    // SISTEMA DE PROMPTS E FÓRMULAS POR MATÉRIA (COM ACE EDITOR)
    // =========================================================================
    let currentRepo = { subId: null, type: null };
    let repoAceInstance = null;

    function openSubjectRepoModal(subId, type) {
      const sub = appState.subjects.find(s => s.id === subId);
      if (!sub) return;

      currentRepo = { subId, type };
      const isPrompt = type === 'prompts';
      
      document.getElementById('repoModalTitle').innerHTML = isPrompt 
        ? `Prompts & Comandos — ${escapeHtml(sub.name)}`
        : `Fórmulas & Conceitos — ${escapeHtml(sub.name)}`;
      
      document.getElementById('repoFormHeading').textContent = isPrompt ? 'Adicionar Novo Prompt / Comando' : 'Adicionar Nova Fórmula / Conceito';
      document.getElementById('repoItemTitle').value = '';
      
      if (repoAceInstance) repoAceInstance.setValue('', -1);

      renderRepoItemsList();
      const modal = new bootstrap.Modal(document.getElementById('subjectRepoModal'));
      modal.show();
      setTimeout(() => repoAceInstance?.resize(), 250);
    }

    function handleSaveRepoItem(e) {
      e.preventDefault();
      const title = document.getElementById('repoItemTitle').value.trim();
      const content = repoAceInstance ? repoAceInstance.getValue().trim() : '';
      if (!title) return;

      const sub = appState.subjects.find(s => s.id === currentRepo.subId);
      if (sub) {
        const list = currentRepo.type === 'prompts' ? sub.prompts : sub.formulas;
        list.push({ id: 'item_' + Date.now(), title, content });
        saveState();
        document.getElementById('repoItemTitle').value = '';
        repoAceInstance.setValue('', -1);
        renderRepoItemsList();
      }
    }

    function deleteRepoItem(itemId) {
      const sub = appState.subjects.find(s => s.id === currentRepo.subId);
      if (sub) {
        undoable('Item excluído.', () => {
          const s = appState.subjects.find(x => x.id === currentRepo.subId);
          if (currentRepo.type === 'prompts') s.prompts = s.prompts.filter(i => i.id !== itemId);
          else s.formulas = s.formulas.filter(i => i.id !== itemId);
        });
        renderRepoItemsList();
      }
    }

    function copyRepoItemContent(encodedText) {
      const text = decodeURIComponent(encodedText);
      navigator.clipboard.writeText(text).then(
        () => uiToast('Copiado!', { type: 'success' }),
        () => uiToast('Não foi possível copiar.', { type: 'error' })
      );
    }

    function renderRepoItemsList() {
      const container = document.getElementById('repoItemsListContainer');
      const sub = appState.subjects.find(s => s.id === currentRepo.subId);
      if (!sub) return;

      const list = currentRepo.type === 'prompts' ? sub.prompts : sub.formulas;
      if (!list || list.length === 0) {
        container.innerHTML = `<div class="text-secondary text-center py-4 small">Nenhum item cadastrado ainda. Use o formulário ao lado para adicionar.</div>`;
        return;
      }

      container.innerHTML = list.map(item => `
        <div class="p-3" style="background: var(--surface-inset); border:1px solid var(--border-subtle); border-radius:var(--radius-sm);">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="fw-bold text-info small">${escapeHtml(item.title)}</span>
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-nexus py-0 px-2" onclick="copyRepoItemContent('${encodeURIComponent(item.content || '')}')">Copiar</button>
              <button class="btn btn-outline-danger py-0 px-2" onclick="deleteRepoItem('${item.id}')">Excluir</button>
            </div>
          </div>
          <pre class="bg-dark p-2 small text-light font-monospace mb-0" style="max-height: 120px; overflow-y: auto; font-size: 0.8rem;">${escapeHtml(item.content || '(Sem conteúdo detalhado)')}</pre>
        </div>
      `).join('');
    }

    // =========================================================================
    // CRONOGRAMA SEMESTRAL INTERATIVO
    // =========================================================================
    const daysOfWeek = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
    const dayShortCodes = {
      'Segunda': 'SEG', 'Terça': 'TER', 'Quarta': 'QUA',
      'Quinta': 'QUI', 'Sexta': 'SEX', 'Sábado': 'SÁB', 'Domingo': 'DOM'
    };

    function getTodayDayName() {
      const jsDay = new Date().getDay();
      const map = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
      return map[jsDay];
    }

    // ---------- Cronograma: vários blocos por dia, com horário ----------
    // appState.schedule[dia] = [{ id, subjectId, time: 'HH:MM' | '', minutes }]
    function emptySchedule() {
      return { 'Segunda': [], 'Terça': [], 'Quarta': [], 'Quinta': [], 'Sexta': [], 'Sábado': [], 'Domingo': [] };
    }

    // Aceita o formato antigo (uma matéria por dia, como texto) e devolve sempre uma lista ordenada
    function getDaySlots(day) {
      const raw = appState.schedule?.[day];
      let slots = [];
      if (typeof raw === 'string') slots = raw ? [{ id: 'slot_' + day, subjectId: raw, time: '', minutes: 60 }] : [];
      else if (Array.isArray(raw)) slots = raw.filter(Boolean);
      else if (raw && typeof raw === 'object') slots = Object.values(raw).filter(Boolean);
      return slots
        .filter(s => appState.subjects.some(sub => sub.id === s.subjectId))
        .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
    }

    function normalizeSchedule(schedule) {
      const out = emptySchedule();
      daysOfWeek.forEach(day => {
        const raw = schedule?.[day];
        if (typeof raw === 'string') out[day] = raw ? [{ id: 'slot_' + day + '_0', subjectId: raw, time: '', minutes: 60 }] : [];
        else if (Array.isArray(raw)) out[day] = raw.filter(Boolean);
        else if (raw && typeof raw === 'object') out[day] = Object.values(raw).filter(Boolean);
      });
      return out;
    }

    // Matéria "da vez": o bloco de hoje em andamento ou o próximo; senão o primeiro do dia
    function getCurrentScheduledSubjectId() {
      const slots = getDaySlots(getTodayDayName());
      if (!slots.length) return '';
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const toMin = (t) => { const [h, m] = (t || '').split(':').map(Number); return isNaN(h) ? null : h * 60 + (m || 0); };
      const current = slots.find(s => {
        const start = toMin(s.time);
        return start !== null && nowMin >= start && nowMin < start + (Number(s.minutes) || 60);
      });
      if (current) return current.subjectId;
      const next = slots.find(s => { const start = toMin(s.time); return start !== null && start > nowMin; });
      return (next || slots[0]).subjectId;
    }

    function renderScheduleUI() {
      const grid = document.getElementById('scheduleCardsGrid');
      if (!grid || !appState) return;
      appState.schedule = normalizeSchedule(appState.schedule);

      const todayDay = getTodayDayName();
      const todayStr = getLocalDateStr();
      const todayMins = (appState.sessions || [])
        .filter(s => s.date === todayStr)
        .reduce((acc, s) => acc + (Number(s.minutes) || 0), 0);

      const subName = (id) => appState.subjects.find(s => s.id === id);
      const todaySlots = getDaySlots(todayDay);
      const spotlightEl = document.getElementById('schedTodaySpotlight');
      if (spotlightEl) {
        spotlightEl.innerHTML = todaySlots.length
          ? todaySlots.map(sl => {
              const s = subName(sl.subjectId);
              return `<span class="sched-chip"><span class="subject-dot" style="background:${s.color}"></span>${sl.time ? `<b>${sl.time}</b> ` : ''}${escapeHtml(s.name)}</span>`;
            }).join(' ')
          : `<span class="text-secondary">${todayDay}: nada planejado</span>`;
      }

      const filledCount = daysOfWeek.filter(d => getDaySlots(d).length > 0).length;
      const plannedMins = daysOfWeek.reduce((acc, d) => acc + getDaySlots(d).reduce((a, s) => a + (Number(s.minutes) || 0), 0), 0);
      const countEl = document.getElementById('schedDaysCount');
      if (countEl) countEl.textContent = `${filledCount}/7 dias · ${Math.round(plannedMins / 60 * 10) / 10}h na semana`;

      grid.innerHTML = daysOfWeek.map(day => {
        const slots = getDaySlots(day);
        const isToday = (day === todayDay);

        const slotsHtml = slots.length ? slots.map(sl => {
          const sub = subName(sl.subjectId);
          return `
            <div class="sched-slot" style="--slot-color:${sub.color}">
              <div class="sched-slot-time">${sl.time || '—'}</div>
              <div class="flex-grow-1 min-w-0">
                <div class="fw-semibold text-truncate">${escapeHtml(sub.name)}</div>
                <small class="text-secondary">${Number(sl.minutes) || 60} min</small>
              </div>
              <button class="btn btn-sm btn-outline-nexus px-2" onclick="startFocusForSubject('${sub.id}')" title="Começar foco"><i class="bi bi-play-fill"></i></button>
              <button class="btn btn-sm btn-outline-nexus px-2" onclick="editScheduleSlot('${day}', '${sl.id}')" title="Editar"><i class="bi bi-pencil"></i></button>
              <button class="btn btn-sm btn-outline-danger px-2" onclick="removeScheduleSlot('${day}', '${sl.id}')" title="Remover"><i class="bi bi-x-lg"></i></button>
            </div>`;
        }).join('') : `
          <div class="text-center text-secondary small py-3">
            <i class="bi bi-cup-hot d-block fs-4 mb-1"></i>Dia livre
          </div>`;

        return `
          <div class="col-12 col-md-6 col-xl-4">
            <div class="sched-card ${isToday ? 'is-today' : ''}">
              <div>
                <div class="sched-header-line d-flex justify-content-between align-items-center">
                  <div class="d-flex align-items-center gap-3">
                    <span class="sched-day-code">${dayShortCodes[day]}</span>
                    <div>
                      <h5 class="fw-semibold mb-0">${day}</h5>
                      <small class="text-secondary">${isToday ? `Hoje · ${todayMins} min focados` : `${slots.length} ${slots.length === 1 ? 'bloco' : 'blocos'}`}</small>
                    </div>
                  </div>
                  ${isToday ? `<span class="badge bg-info text-dark">Hoje</span>` : ''}
                </div>
                <div class="d-flex flex-column gap-2 mb-3">${slotsHtml}</div>
              </div>
              <button class="btn btn-outline-nexus btn-sm w-100" onclick="addScheduleSlot('${day}')">
                <i class="bi bi-plus-lg me-1"></i> Adicionar matéria
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

    async function scheduleSlotForm(day, slot) {
      if (!appState.subjects.length) {
        uiToast('Cadastre uma matéria primeiro.', { type: 'warning' });
        return null;
      }
      return uiForm({
        title: `${slot ? 'Editar' : 'Adicionar'} · ${day}`,
        okLabel: 'Salvar',
        fields: [
          { name: 'subjectId', label: 'Matéria', type: 'select', value: slot?.subjectId || appState.subjects[0].id,
            options: appState.subjects.map(s => ({ value: s.id, label: s.name })) },
          { name: 'time', label: 'Horário (opcional)', type: 'time', value: slot?.time || '' },
          { name: 'minutes', label: 'Duração (min)', type: 'number', min: 10, max: 600, step: 5, value: slot?.minutes || 60 }
        ],
        validate: v => (Number(v.minutes) >= 10 ? '' : 'A duração mínima é 10 minutos.')
      });
    }

    async function addScheduleSlot(day) {
      const vals = await scheduleSlotForm(day, null);
      if (!vals) return;
      appState.schedule = normalizeSchedule(appState.schedule);
      appState.schedule[day].push({ id: 'slot_' + Date.now(), subjectId: vals.subjectId, time: vals.time, minutes: Number(vals.minutes) });
      saveState();
      renderScheduleUI();
    }

    async function editScheduleSlot(day, slotId) {
      appState.schedule = normalizeSchedule(appState.schedule);
      const slot = appState.schedule[day].find(s => s.id === slotId);
      if (!slot) return;
      const vals = await scheduleSlotForm(day, slot);
      if (!vals) return;
      Object.assign(slot, { subjectId: vals.subjectId, time: vals.time, minutes: Number(vals.minutes) });
      saveState();
      renderScheduleUI();
    }

    function removeScheduleSlot(day, slotId) {
      undoable('Bloco removido do cronograma.', () => {
        appState.schedule = normalizeSchedule(appState.schedule);
        appState.schedule[day] = appState.schedule[day].filter(s => s.id !== slotId);
      });
      renderScheduleUI();
    }

    async function autoDistributeSchedule() {
      if (!appState.subjects || appState.subjects.length === 0) {
        uiToast('Cadastre pelo menos uma matéria antes de distribuir o cronograma.', { type: 'warning' });
        return;
      }
      const hasAny = daysOfWeek.some(d => getDaySlots(d).length > 0);
      if (hasAny && !(await uiConfirm('Isso substitui o cronograma atual por uma matéria por dia (segunda a sábado).', { title: 'Distribuir automaticamente', okLabel: 'Substituir' }))) return;
      undoable('Cronograma distribuído.', () => {
        const sched = emptySchedule();
        daysOfWeek.forEach((day, idx) => {
          if (day === 'Domingo') return;
          const sub = appState.subjects[idx % appState.subjects.length];
          sched[day] = [{ id: `slot_${Date.now()}_${idx}`, subjectId: sub.id, time: '', minutes: 60 }];
        });
        appState.schedule = sched;
      });
      renderScheduleUI();
    }

    async function clearEntireSchedule() {
      if (!(await uiConfirm('Limpar o cronograma da semana inteira?', { title: 'Limpar cronograma', okLabel: 'Limpar', danger: true }))) return;
      undoable('Cronograma limpo.', () => { appState.schedule = emptySchedule(); });
      renderScheduleUI();
    }

    function startFocusForSubject(subId) {
      const pomoSel = document.getElementById('pomoSubjectSelect');
      if (pomoSel && subId) pomoSel.value = subId;
      switchMobileTab('#tab-pomodoro');
    }

    function startFocusForTodaySchedule() {
      const subId = getCurrentScheduledSubjectId();
      if (subId) startFocusForSubject(subId);
      else switchMobileTab('#tab-pomodoro');
    }

    function checkTodayScheduleSelection() {
      if (!appState.schedule || pomoInterval) return;
      const scheduledSubId = getCurrentScheduledSubjectId();
      if (scheduledSubId) {
        const pomoSel = document.getElementById('pomoSubjectSelect');
        if (pomoSel) pomoSel.value = scheduledSubId;
      }
    }

    // =========================================================================
    // GALERIA DE 100 CONQUISTAS E INSÍGNIA PLATINA
    // =========================================================================
    let currentBadgeStatusFilter = 'all';

    function setBadgeStatusFilter(status) {
      currentBadgeStatusFilter = status;
      document.getElementById('btnFilterBadgeAll')?.classList.toggle('active', status === 'all');
      document.getElementById('btnFilterBadgeUnlocked')?.classList.toggle('active', status === 'unlocked');
      document.getElementById('btnFilterBadgeLocked')?.classList.toggle('active', status === 'locked');
      renderBadgesWall();
    }

    function renderBadgesWall() {
      const container = document.getElementById('badgesWallContainer');
      if (!container || !appState) return;

      const sessions = appState.sessions || [];
      const totalSessions = sessions.length;
      const totalMins = sessions.reduce((acc, s) => acc + (Number(s.minutes) || 0), 0);
      const maxSingleSession = sessions.reduce((max, s) => Math.max(max, Number(s.minutes) || 0), 0);
      const microSessionsCount = sessions.filter(s => Number(s.minutes) === 10 || (s.note && s.note.includes('Micro-Estudo'))).length;

      const minsByDate = {};
      const sessionsByDate = {};
      const shiftCounts = { dawn: 0, morning: 0, afternoon: 0, night: 0 };
      const shifts = { dawn: 0, morning: 0, afternoon: 0, night: 0 };
      let studiedSaturday = false;
      let studiedSunday = false;

      sessions.forEach(s => {
        const m = Number(s.minutes) || 0;
        if (s.date) {
          minsByDate[s.date] = (minsByDate[s.date] || 0) + m;
          sessionsByDate[s.date] = (sessionsByDate[s.date] || 0) + 1;
          const dObj = new Date(s.date + 'T12:00:00');
          if (dObj.getDay() === 6) studiedSaturday = true;
          if (dObj.getDay() === 0) studiedSunday = true;
        }
        const hr = s.timestamp ? parseInt(s.timestamp.split(':')[0], 10) : 20;
        if (hr >= 0 && hr < 6) { shifts.dawn += m; shiftCounts.dawn++; }
        else if (hr >= 6 && hr < 12) { shifts.morning += m; shiftCounts.morning++; }
        else if (hr >= 12 && hr < 18) { shifts.afternoon += m; shiftCounts.afternoon++; }
        else { shifts.night += m; shiftCounts.night++; }
      });

      const maxDailyMins = Math.max(0, ...Object.values(minsByDate));
      const maxDailySessions = Math.max(0, ...Object.values(sessionsByDate));
      const activeDaysCount = Object.keys(minsByDate).filter(d => minsByDate[d] > 0).length;
      const streak = calculateStreak();
      const todayMins = minsByDate[getLocalDateStr()] || 0;
      const dailyGoal = Number(appState.settings?.dailyGoalMinutes) || 120;

      const subjects = appState.subjects || [];
      const totalLessonsPossible = subjects.reduce((acc, s) => acc + countLessons(s), 0);
      let totalLessonsDone = 0;
      let closedUnitsCount = 0;
      let closedSubjectsCount = 0;
      let subjectsWith1Hour = 0;
      let hitSubjectTargetHours = false;
      let allSubjectsUnit1Done = subjects.length > 0;

      let scoredUnitsCount = 0;
      let sumUnitScores = 0;
      let hasPerfectUnit = false;
      let hasQuadraPerfeita = false;
      let totalQuizQuestions = 0;

      let lessonsWithNotes = 0;
      let totalNoteChars = 0;
      let totalPrompts = 0;
      let totalFormulas = 0;

      subjects.forEach(sub => {
        if ((Number(sub.minutesStudied) || 0) >= 60) subjectsWith1Hour++;
        if ((Number(sub.minutesStudied) || 0) >= (Number(sub.targetHours) || 40) * 60) hitSubjectTargetHours = true;
        totalPrompts += (sub.prompts || []).length;
        totalFormulas += (sub.formulas || []).length;

        let subLessonsDone = 0;
        let subPerfectUnits = 0;

        (sub.units || []).forEach((u, uIdx) => {
          const uDone = (u.lessons || []).filter(l => l.done).length;
          totalLessonsDone += uDone;
          subLessonsDone += uDone;
          const uTotal = (u.lessons || []).length;
          if (uTotal > 0 && uDone === uTotal) closedUnitsCount++;
          if (uIdx === 0 && uDone < uTotal) allSubjectsUnit1Done = false;

          if (u.score !== null && u.score !== undefined && u.score !== '') {
            const sc = Number(u.score);
            scoredUnitsCount++;
            sumUnitScores += sc;
            if (sc === 5) { hasPerfectUnit = true; subPerfectUnits++; }
          }

          totalQuizQuestions += (u.quizQuestions || []).length;

          (u.lessons || []).forEach(l => {
            const txt = (l.note || '').trim();
            if (txt.length > 0) { lessonsWithNotes++; totalNoteChars += txt.length; }
          });
        });

        if (countLessons(sub) > 0 && subLessonsDone === countLessons(sub)) closedSubjectsCount++;
        if ((sub.units || []).length > 0 && subPerfectUnits === sub.units.length) hasQuadraPerfeita = true;
      });

      const lessonsCompletionPct = totalLessonsPossible > 0 ? (totalLessonsDone / totalLessonsPossible) * 100 : 0;
      const avgQuizPct = scoredUnitsCount > 0 ? (sumUnitScores / (scoredUnitsCount * 5)) * 100 : 0;

      const flashcards = appState.flashcards || [];
      const totalFlashcards = flashcards.length;
      const totalFcReviews = flashcards.reduce((acc, c) => acc + (Number(c.reviewsCount) || 0), 0);

      const scheduleDaysFilled = daysOfWeek.filter(d => getDaySlots(d).length > 0).length;
      const tasks = appState.tasks || [];
      const doneTasks = tasks.filter(t => t.status === 'done');
      const doingOrDoneTasks = tasks.filter(t => t.status === 'doing' || t.status === 'done');
      const doneWorks = doneTasks.filter(t => t.type === 'Trabalho').length;
      const doneExams = doneTasks.filter(t => t.type === 'Prova').length;
      const beatEstimateTask = doneTasks.some(t => Number(t.actualMinutes) > 0 && Number(t.actualMinutes) <= (Number(t.estMinutes) || 60));

      const waterGoal = Number(appState.settings?.waterGoalMl) || 3000;
      const hydrationValues = Object.values(appState.hydration || {}).map(v => Number(v) || 0);
      const waterGoalDays = hydrationValues.filter(ml => ml >= waterGoal).length;
      const totalWaterMl = hydrationValues.reduce((a, b) => a + b, 0);
      const g = calculateGamification();

      const badges = [
        { id: 1, cat: 'foco', icon: '🌱', title: 'Hello, World!', desc: 'Concluiu a 1ª sessão de foco', unlocked: totalSessions >= 1 },
        { id: 2, cat: 'foco', icon: '⚡', title: 'Ignição Rápida', desc: 'Concluiu 1 sessão de Micro-Estudo (10m)', unlocked: microSessionsCount >= 1 },
        { id: 3, cat: 'foco', icon: '🔋', title: 'Curto-Circuito Produtivo', desc: '10 sessões de Micro-Estudo', unlocked: microSessionsCount >= 10 },
        { id: 4, cat: 'foco', icon: '🧘', title: 'Estado de Flow', desc: 'Sessão única de 50+ min', unlocked: maxSingleSession >= 50 },
        { id: 5, cat: 'foco', icon: '💎', title: 'Hiperfoco Blindado', desc: 'Sessão de 60 min ininterruptos', unlocked: maxSingleSession >= 60 },
        { id: 6, cat: 'foco', icon: '🕯️', title: 'Vigília Silenciosa', desc: '120+ min focado em um único dia', unlocked: maxDailyMins >= 120 },
        { id: 7, cat: 'foco', icon: '🌌', title: 'Overclock Neural', desc: '180+ min focado em um único dia', unlocked: maxDailyMins >= 180 },
        { id: 8, cat: 'foco', icon: '🔥', title: 'Titã da Maratona', desc: '300+ min (5h) focados no mesmo dia', unlocked: maxDailyMins >= 300 },
        { id: 9, cat: 'foco', icon: '🔁', title: 'Dobradinha', desc: '2 sessões concluídas no mesmo dia', unlocked: maxDailySessions >= 2 },
        { id: 10, cat: 'foco', icon: '🎯', title: 'Hat-Trick Acadêmico', desc: '3 sessões concluídas no mesmo dia', unlocked: maxDailySessions >= 3 },
        { id: 11, cat: 'foco', icon: '🚀', title: 'Penta-Kill do Estudo', desc: '5 sessões concluídas no mesmo dia', unlocked: maxDailySessions >= 5 },
        { id: 12, cat: 'foco', icon: '🎖️', title: 'Veterano de Sessões', desc: '50 sessões registradas no histórico', unlocked: totalSessions >= 50 },
        { id: 13, cat: 'foco', icon: '💯', title: 'Centenário de Pomodoro', desc: '100 sessões de foco registradas', unlocked: totalSessions >= 100 },
        { id: 14, cat: 'foco', icon: '⏱️', title: 'Primeiras 10 Horas', desc: 'Acumulou 600 min (10h) de foco', unlocked: totalMins >= 600 },
        { id: 15, cat: 'foco', icon: '⏳', title: 'Senhor do Tempo', desc: 'Acumulou 1.500 min (25h) de foco', unlocked: totalMins >= 1500 },
        { id: 16, cat: 'foco', icon: '🛠️', title: 'Meio Semestre no Braço', desc: 'Acumulou 3.000 min (50h) de foco', unlocked: totalMins >= 3000 },
        { id: 17, cat: 'foco', icon: '🏔️', title: 'Escalada Olímpica', desc: 'Acumulou 4.500 min (75h) de foco', unlocked: totalMins >= 4500 },
        { id: 18, cat: 'foco', icon: '🚀', title: 'Centurião do Foco', desc: 'Acumulou 6.000 min (100h) de foco', unlocked: totalMins >= 6000 },
        { id: 19, cat: 'foco', icon: '🌠', title: 'Viajante Interestelar', desc: 'Acumulou 12.000 min (200h) de foco', unlocked: totalMins >= 12000 },
        { id: 20, cat: 'foco', icon: '♾️', title: 'Imortal do Foco', desc: 'Acumulou 30.000 min (500h) de foco', unlocked: totalMins >= 30000 },

        { id: 21, cat: 'constancia', icon: '🦉', title: 'Guardião da Madrugada', desc: 'Estudou entre 00h00 e 05h59', unlocked: shiftCounts.dawn >= 1 },
        { id: 22, cat: 'constancia', icon: '🦇', title: 'Coruja de Plantão', desc: '10 sessões na madrugada', unlocked: shiftCounts.dawn >= 10 },
        { id: 23, cat: 'constancia', icon: '🧛', title: 'Senhor das Sombras', desc: '300+ min na madrugada', unlocked: shifts.dawn >= 300 },
        { id: 24, cat: 'constancia', icon: '🌅', title: 'Alvorada Binária', desc: 'Estudou pela manhã (06h–11h59)', unlocked: shiftCounts.morning >= 1 },
        { id: 25, cat: 'constancia', icon: '☕', title: 'Clube das 6 da Manhã', desc: '10 sessões pela manhã', unlocked: shiftCounts.morning >= 10 },
        { id: 26, cat: 'constancia', icon: '🌇', title: 'Crepúsculo Produtivo', desc: '10 sessões durante a tarde', unlocked: shiftCounts.afternoon >= 10 },
        { id: 27, cat: 'constancia', icon: '☀️', title: 'Engenheiro Solar', desc: '300+ min estudados à tarde', unlocked: shifts.afternoon >= 300 },
        { id: 28, cat: 'constancia', icon: '🌙', title: 'Operador Noturno', desc: '600+ min estudados à noite', unlocked: shifts.night >= 600 },
        { id: 29, cat: 'constancia', icon: '🌆', title: 'Cidadão de Night City', desc: '20 sessões concluídas à noite', unlocked: shiftCounts.night >= 20 },
        { id: 30, cat: 'constancia', icon: '🌈', title: 'Onipresente', desc: 'Sessões na Madrugada, Manhã, Tarde e Noite', unlocked: shiftCounts.dawn > 0 && shiftCounts.morning > 0 && shiftCounts.afternoon > 0 && shiftCounts.night > 0 },
        { id: 31, cat: 'constancia', icon: '⚔️', title: 'Guerreiro de Fim de Semana', desc: 'Estudou no sábado e no domingo', unlocked: studiedSaturday && studiedSunday },
        { id: 32, cat: 'constancia', icon: '🔗', title: 'Trinca de Ferro', desc: '3 dias seguidos de ofensiva', unlocked: streak >= 3 },
        { id: 33, cat: 'constancia', icon: '🛡️', title: 'Semana Inabalável', desc: '7 dias seguidos de ofensiva', unlocked: streak >= 7 },
        { id: 34, cat: 'constancia', icon: '👑', title: 'Constância Inquebrável', desc: '15 dias seguidos de ofensiva', unlocked: streak >= 15 },
        { id: 35, cat: 'constancia', icon: '🌋', title: 'Lenda Mensal', desc: '30 dias seguidos de ofensiva', unlocked: streak >= 30 },
        { id: 36, cat: 'constancia', icon: '💎', title: 'Ofensiva de Platina', desc: '60 dias seguidos de ofensiva', unlocked: streak >= 60 },
        { id: 37, cat: 'constancia', icon: '🗓️', title: 'Mês Ativo no Heatmap', desc: '30 dias diferentes no Heatmap', unlocked: activeDaysCount >= 30 },
        { id: 38, cat: 'constancia', icon: '🗓️', title: 'Trimestre de Aço', desc: '90 dias diferentes no Heatmap', unlocked: activeDaysCount >= 90 },

        { id: 39, cat: 'academico', icon: '📖', title: 'Primeiro Passo na Grade', desc: '1ª aula concluída', unlocked: totalLessonsDone >= 1 },
        { id: 40, cat: 'academico', icon: '🧱', title: 'Fundação Sólida', desc: '10 aulas concluídas', unlocked: totalLessonsDone >= 10 },
        { id: 41, cat: 'academico', icon: '🏗️', title: 'Estrutura Erguida', desc: '30 aulas concluídas', unlocked: totalLessonsDone >= 30 },
        { id: 42, cat: 'academico', icon: '🏰', title: 'Fortaleza do Saber', desc: '50 aulas concluídas', unlocked: totalLessonsDone >= 50 },
        { id: 43, cat: 'academico', icon: '📦', title: 'Unidade Fechada', desc: 'Todas as aulas de uma unidade', unlocked: closedUnitsCount >= 1 },
        { id: 44, cat: 'academico', icon: '⚖️', title: 'Largada Sincronizada', desc: 'Unidade 1 concluída em todas as matérias', unlocked: allSubjectsUnit1Done },
        { id: 45, cat: 'academico', icon: '🏛️', title: 'Pilar Concluído', desc: '20/20 aulas de uma matéria inteira', unlocked: closedSubjectsCount >= 1 },
        { id: 46, cat: 'academico', icon: '🎓', title: 'Tríade Acadêmica', desc: '20/20 aulas em 3 matérias', unlocked: closedSubjectsCount >= 3 },
        { id: 47, cat: 'academico', icon: '🗂️', title: 'Grade Completa', desc: '5+ disciplinas cadastradas', unlocked: subjects.length >= 5 },
        { id: 48, cat: 'academico', icon: '🧭', title: 'Explorador Multidisciplinar', desc: '1h+ em 3 matérias diferentes', unlocked: subjectsWith1Hour >= 3 },
        { id: 49, cat: 'academico', icon: '🎯', title: 'Meta Semestral Batida', desc: '100% das horas-meta de uma matéria', unlocked: hitSubjectTargetHours },
        { id: 50, cat: 'academico', icon: '📚', title: 'Meio Caminho Andado', desc: '50% das aulas concluídas', unlocked: lessonsCompletionPct >= 50 },
        { id: 51, cat: 'academico', icon: '🏁', title: 'Reta Final', desc: '75% das aulas concluídas', unlocked: lessonsCompletionPct >= 75 },
        { id: 52, cat: 'academico', icon: '🏆', title: 'Semestre Zerado', desc: '100% das aulas do semestre concluídas', unlocked: totalLessonsPossible > 0 && lessonsCompletionPct >= 100 },

        { id: 53, cat: 'exercicios', icon: '🥉', title: 'Primeira Avaliação', desc: '1ª nota de exercícios registrada', unlocked: scoredUnitsCount >= 1 },
        { id: 54, cat: 'exercicios', icon: '🎯', title: 'Na Mosca!', desc: 'Nota máxima (5/5) em uma unidade', unlocked: hasPerfectUnit },
        { id: 55, cat: 'exercicios', icon: '🌟', title: 'Quadra de Ases', desc: 'Nota 5/5 nas 4 unidades de uma matéria', unlocked: hasQuadraPerfeita },
        { id: 56, cat: 'exercicios', icon: '🧠', title: 'Mente Testada', desc: '8 unidades avaliadas', unlocked: scoredUnitsCount >= 8 },
        { id: 57, cat: 'exercicios', icon: '🥈', title: 'Dez Unidades', desc: '10 unidades avaliadas', unlocked: scoredUnitsCount >= 10 },
        { id: 58, cat: 'exercicios', icon: '🥇', title: 'Vinte Unidades', desc: '20 unidades avaliadas', unlocked: scoredUnitsCount >= 20 },
        { id: 59, cat: 'exercicios', icon: '📈', title: 'Acima da Média', desc: 'Aproveitamento >= 80% (mín. 4 unidades)', unlocked: scoredUnitsCount >= 4 && avgQuizPct >= 80 },
        { id: 60, cat: 'exercicios', icon: '🏅', title: 'Gabarito Impecável', desc: 'Aproveitamento 100% (mín. 6 unidades)', unlocked: scoredUnitsCount >= 6 && avgQuizPct === 100 },
        { id: 61, cat: 'exercicios', icon: '🎯', title: 'Sniper de Pontos', desc: '50+ acertos somados nas unidades', unlocked: sumUnitScores >= 50 },
        { id: 62, cat: 'exercicios', icon: '💯', title: 'Pontuação Centenária', desc: '100+ acertos somados nas unidades', unlocked: sumUnitScores >= 100 },
        { id: 63, cat: 'exercicios', icon: '🧩', title: 'Criador de Desafios', desc: '5 questões cadastradas nos Simulados', unlocked: totalQuizQuestions >= 5 },
        { id: 64, cat: 'exercicios', icon: '🏛️', title: 'Banca Examinadora', desc: '20 questões cadastradas nos Simulados', unlocked: totalQuizQuestions >= 20 },
        { id: 65, cat: 'exercicios', icon: '🧠', title: 'Fábrica de Provas', desc: '50 questões cadastradas nos Simulados', unlocked: totalQuizQuestions >= 50 },

        { id: 66, cat: 'conhecimento', icon: '📝', title: 'Escriba Digital', desc: '1ª anotação salva no Ace Editor', unlocked: lessonsWithNotes >= 1 },
        { id: 67, cat: 'conhecimento', icon: '📓', title: 'Documentação Completa', desc: '10 aulas com anotações salvas', unlocked: lessonsWithNotes >= 10 },
        { id: 68, cat: 'conhecimento', icon: '📜', title: 'Enciclopédia Pessoal', desc: '25 aulas com anotações salvas', unlocked: lessonsWithNotes >= 25 },
        { id: 69, cat: 'conhecimento', icon: '✍️', title: 'Autor Dedicado', desc: '1.000+ caracteres nas notas', unlocked: totalNoteChars >= 1000 },
        { id: 70, cat: 'conhecimento', icon: '📖', title: 'Escritor Técnico', desc: '5.000+ caracteres nas notas', unlocked: totalNoteChars >= 5000 },
        { id: 71, cat: 'conhecimento', icon: '📚', title: 'Autor de Compêndio', desc: '15.000+ caracteres escritos', unlocked: totalNoteChars >= 15000 },
        { id: 72, cat: 'conhecimento', icon: '💻', title: 'Colecionador de Snippets', desc: '5 prompts salvos', unlocked: totalPrompts >= 5 },
        { id: 73, cat: 'conhecimento', icon: '🐚', title: 'Mestre do Terminal', desc: '15 prompts salvos', unlocked: totalPrompts >= 15 },
        { id: 74, cat: 'conhecimento', icon: '📐', title: 'Mestre dos Teoremas', desc: '5 fórmulas salvas', unlocked: totalFormulas >= 5 },
        { id: 75, cat: 'conhecimento', icon: '🧮', title: 'Arquimedes Moderno', desc: '15 fórmulas salvas', unlocked: totalFormulas >= 15 },
        { id: 76, cat: 'conhecimento', icon: '🗄️', title: 'Arsenal Dev', desc: '20+ itens (Prompts + Fórmulas)', unlocked: (totalPrompts + totalFormulas) >= 20 },
        { id: 77, cat: 'conhecimento', icon: '🃏', title: 'Primeiro Cartão', desc: '1º Flashcard criado', unlocked: totalFlashcards >= 1 },
        { id: 78, cat: 'conhecimento', icon: '🎴', title: 'Forjador de Memória', desc: '10 Flashcards criados', unlocked: totalFlashcards >= 10 },
        { id: 79, cat: 'conhecimento', icon: '🔮', title: 'Mestre do Baralho', desc: '30 Flashcards criados', unlocked: totalFlashcards >= 30 },
        { id: 80, cat: 'conhecimento', icon: '🏛️', title: 'Biblioteca de Alexandria', desc: '50 Flashcards criados', unlocked: totalFlashcards >= 50 },
        { id: 81, cat: 'conhecimento', icon: '🔄', title: 'Sinapse Reforçada', desc: '25 revisões na Arena de Flashcards', unlocked: totalFcReviews >= 25 },
        { id: 82, cat: 'conhecimento', icon: '🧠', title: 'Memória Eidética', desc: '100 revisões de Flashcards', unlocked: totalFcReviews >= 100 },
        { id: 83, cat: 'conhecimento', icon: '⚡', title: 'Sinapse de Ouro', desc: '250 revisões de Flashcards', unlocked: totalFcReviews >= 250 },

        { id: 84, cat: 'gestao', icon: '📅', title: 'Arquiteto da Rotina', desc: '5+ dias configurados no Cronograma', unlocked: scheduleDaysFilled >= 5 },
        { id: 85, cat: 'gestao', icon: '🗓️', title: 'Semana Blindada', desc: 'Todos os 7 dias configurados', unlocked: scheduleDaysFilled >= 7 },
        { id: 86, cat: 'gestao', icon: '✅', title: 'Missão Cumprida', desc: '1ª tarefa concluída no Kanban', unlocked: doneTasks.length >= 1 },
        { id: 87, cat: 'gestao', icon: '🏃', title: 'Em Movimento', desc: 'Tarefa movida para Em Andamento', unlocked: doingOrDoneTasks.length >= 1 },
        { id: 88, cat: 'gestao', icon: '💻', title: 'Entregador de Projetos', desc: '5 Trabalhos concluídos no Kanban', unlocked: doneWorks >= 5 },
        { id: 89, cat: 'gestao', icon: '🎓', title: 'Sobrevivente de Provas', desc: '5 Provas concluídas no Kanban', unlocked: doneExams >= 5 },
        { id: 90, cat: 'gestao', icon: '⚔️', title: 'Exterminador de Pendências', desc: '10 tarefas concluídas no Kanban', unlocked: doneTasks.length >= 10 },
        { id: 91, cat: 'gestao', icon: '🎯', title: 'Relógio Suíço', desc: 'Tarefa concluída no prazo estimado', unlocked: beatEstimateTask },

        { id: 92, cat: 'rpg', icon: '💧', title: 'Protocolo Hidratado', desc: '100% da meta de água batida', unlocked: waterGoalDays >= 1 },
        { id: 93, cat: 'rpg', icon: '🌊', title: 'Fonte Inesgotável', desc: '7 dias batendo a meta de água', unlocked: waterGoalDays >= 7 },
        { id: 94, cat: 'rpg', icon: '🐳', title: 'Oceano Particular', desc: '30 litros (30.000 ml) registrados', unlocked: totalWaterMl >= 30000 },
        { id: 95, cat: 'rpg', icon: '🎯', title: 'Meta Diária Cravada', desc: 'Meta diária de estudos batida hoje', unlocked: todayMins >= dailyGoal },
        { id: 96, cat: 'rpg', icon: '🛡️', title: 'Iniciado da Ordem (Nv. 5)', desc: 'Alcançou o Nível 5', unlocked: g.level >= 5 },
        { id: 97, cat: 'rpg', icon: '⚔️', title: 'Veterano de Sistemas (Nv. 10)', desc: 'Alcançou o Nível 10', unlocked: g.level >= 10 },
        { id: 98, cat: 'rpg', icon: '🧙‍♂️', title: 'Arcano do Código (Nv. 25)', desc: 'Alcançou o Nível 25', unlocked: g.level >= 25 },
        { id: 99, cat: 'rpg', icon: '🌟', title: 'Semideus Acadêmico (Nv. 50)', desc: 'Alcançou o Nível 50', unlocked: g.level >= 50 }
      ];

      const unlocked99 = badges.filter(b => b.unlocked).length;
      badges.push({
        id: 100,
        cat: 'rpg',
        icon: '🏆',
        title: 'Platina Nexus: O Onisciente',
        desc: 'Desbloqueou todas as 99 insígnias!',
        unlocked: unlocked99 === 99
      });

      const totalUnlocked = badges.filter(b => b.unlocked).length;
      const pct = Math.round((totalUnlocked / 100) * 100);

      document.getElementById('badgesCountText').textContent = `${totalUnlocked} / 100 desbloqueadas (${pct}% concluído)`;
      document.getElementById('badgesProgressBar').style.width = `${pct}%`;

      const catFilter = document.getElementById('badgeCategoryFilter')?.value || 'all';
      const filtered = badges.filter(b => {
        const matchCat = catFilter === 'all' || b.cat === catFilter;
        const matchStatus = currentBadgeStatusFilter === 'all'
          || (currentBadgeStatusFilter === 'unlocked' && b.unlocked)
          || (currentBadgeStatusFilter === 'locked' && !b.unlocked);
        return matchCat && matchStatus;
      });

      container.innerHTML = filtered.map(b => `
        <div class="col-12 col-sm-6 col-md-4 col-xl-3">
          <div class="badge-item ${b.unlocked ? 'unlocked' : 'locked'} h-100 d-flex align-items-center gap-2">
            <span class="fs-3">${b.icon}</span>
            <div class="text-truncate">
              <div class="fw-bold small text-white text-truncate">#${b.id} ${b.title}</div>
              <small class="text-secondary d-block text-truncate" style="font-size:0.72rem;">${b.desc}</small>
            </div>
          </div>
        </div>
      `).join('');
    }

    // =========================================================================
    // INICIALIZAÇÃO GERAL AO ABRIR O ARQUIVO
    // =========================================================================
    window.addEventListener('DOMContentLoaded', async () => {
      loadState();
      document.getElementById('lblFocusMins').textContent = appState.settings.focusMinutes || 25;
      document.getElementById('btnErgo2020')?.classList.toggle('active', appState.settings.ergo2020Enabled !== false);
      document.getElementById('btnGatekeeper')?.classList.toggle('active', Boolean(appState.settings.gatekeeperEnabled));
      pomoMode = 'focus';
      pomoTotalSeconds = secondsForMode('focus');
      pomoSecondsLeft = pomoTotalSeconds;
      updatePomodoroClockUI();
      document.getElementById('taskDate').value = getLocalDateStr();

      setTimeout(() => {
        const container = document.getElementById('editorContainer');
        if (container && !aceEditorInstance) {
          aceEditorInstance = ace.edit("editorContainer");
          aceEditorInstance.setTheme("ace/theme/one_dark");
          aceEditorInstance.session.setMode("ace/mode/markdown");
          aceEditorInstance.setOptions({ fontSize: "14px", showPrintMargin: false, highlightActiveLine: true, tabSize: 2, useSoftTabs: true });
        }

        const repoEl = document.getElementById('repoEditorContainer');
        if (repoEl && !repoAceInstance) {
          repoAceInstance = ace.edit("repoEditorContainer");
          repoAceInstance.setTheme("ace/theme/one_dark");
          repoAceInstance.session.setMode("ace/mode/markdown");
          repoAceInstance.setOptions({ fontSize: "13px", showPrintMargin: false, tabSize: 2, useSoftTabs: true });
        }

        const pyEl = document.getElementById('pyAceContainer');
        if (pyEl && !pyAceEditor) {
          pyAceEditor = ace.edit("pyAceContainer");
          pyAceEditor.setTheme("ace/theme/one_dark");
          pyAceEditor.session.setMode("ace/mode/python");
          pyAceEditor.setOptions({ fontSize: "14px", showPrintMargin: false, tabSize: 4, useSoftTabs: true });
          pyAceEditor.setValue(`# Exemplo rápido em Python 3\ndef fatorial(n):\n    return 1 if n <= 1 else n * fatorial(n - 1)\n\nfor i in range(1, 6):\n    print(f"{i}! = {fatorial(i)}")`, -1);
        }
      }, 400);

      updateAllUI();
      restorePomodoroFromStorage();
      document.getElementById('pomoSubjectSelect')?.addEventListener('change', persistPomoState);
      document.getElementById('pomoTaskSelect')?.addEventListener('change', persistPomoState);
      refreshCharts();
      generateTruthTable();
      calcBitwise();
      await initFolderSyncStatus();

      // App instalável e funcionando offline (PWA)
      if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
        navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker:', err));
      }
    });

    // Sincronização na nuvem: ver js/cloud.js (login com Google + Firebase)

    // =========================================================================
    // ETAPA 1 MOBILE: AUTO-HIDE HEADER AO ROLAR A TELA
    // =========================================================================
    (function initAutoHideHeader() {
      let lastScrollY = window.scrollY;
      const headerEl = document.getElementById('mainAppHeader');

      window.addEventListener('scroll', () => {
        if (!headerEl) return;
        const currentScrollY = window.scrollY;

        // Esconde ao rolar para baixo após 70px; mostra imediatamente ao subir
        if (currentScrollY > lastScrollY && currentScrollY > 70) {
          headerEl.classList.add('header-hidden');
          // Fecha a gaveta mobile caso estivesse aberta
          const mobCollapse = document.getElementById('mobileHeaderCollapse');
          if (mobCollapse && mobCollapse.classList.contains('show')) {
            bootstrap.Collapse.getInstance(mobCollapse)?.hide();
          }
        } else if (currentScrollY < lastScrollY - 8 || currentScrollY <= 20) {
          headerEl.classList.remove('header-hidden');
        }

        lastScrollY = currentScrollY;
      }, { passive: true });
    })();

    // =========================================================================
    // ETAPA 2 MOBILE: CONTROLE DA BARRA INFERIOR & GAVETA "MAIS"
    // =========================================================================
    function toggleMobMoreDrawer(forceState) {
      const drawer = document.getElementById('mobMoreDrawer');
      const backdrop = document.getElementById('mobDrawerBackdrop');
      const bottomNav = document.getElementById('mobileBottomNav');
      if (!drawer) return;

      const shouldOpen = typeof forceState === 'boolean' ? forceState : !drawer.classList.contains('show');

      if (shouldOpen && bottomNav) {
        // Mede a altura exata da barra inferior no aparelho atual para nunca cortar o último botão
        const navHeight = bottomNav.offsetHeight || 74;
        drawer.style.bottom = `${navHeight}px`;
      }

      drawer.classList.toggle('show', shouldOpen);
      if (backdrop) backdrop.classList.toggle('show', shouldOpen);
    }

    function switchMobileTab(targetSelector) {
      toggleMobMoreDrawer(false);
      const desktopTabBtn = document.querySelector(`#mainNavTabs [data-bs-target="${targetSelector}"]`);
      if (desktopTabBtn) {
        desktopTabBtn.click();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      syncMobileBottomNavHighlight(targetSelector);
    }

    function syncMobileBottomNavHighlight(targetSelector) {
      const mainBtns = document.querySelectorAll('#mobileBottomNav .mob-nav-btn[data-target]');
      const drawerBtns = document.querySelectorAll('#mobMoreDrawer .mob-drawer-link');
      const moreBtn = document.getElementById('mobBtnMore');

      let matchedMain = false;
      mainBtns.forEach(btn => {
        const isMatch = btn.getAttribute('data-target') === targetSelector;
        btn.classList.toggle('active', isMatch);
        if (isMatch) matchedMain = true;
      });

      drawerBtns.forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-target') === targetSelector);
      });

      if (moreBtn) {
        moreBtn.classList.toggle('active', !matchedMain);
      }
    }

    // Mantém a barra inferior sincronizada mesmo se a aba mudar por outro botão da tela
    document.addEventListener('shown.bs.tab', (e) => {
      const target = e.target?.getAttribute('data-bs-target');
      if (target) syncMobileBottomNavHighlight(target);
    });

   // =========================================================================
    // ETAPA 4 MOBILE: VIBRAÇÃO TÁTIL, SWIPE, PULL-TO-REFRESH & SEGUNDO PLANO
    // =========================================================================
    function triggerHaptic(pattern = 12) {
      try { if ('vibrate' in navigator) navigator.vibrate(pattern); } catch {}
    }

    document.addEventListener('click', (e) => {
      if (e.target.closest('button, .btn, .mob-nav-btn, .sync-badge, input[type="checkbox"]')) {
        triggerHaptic(12);
      } else if (e.target.closest('#fcStudyBox')) {
        triggerHaptic([15, 30, 15]);
      }
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (pomoInterval && pomoTargetEndTime) pomoTick();
        if (microInterval && microTargetEndTime) microTick();
      }
    });

    (function initTouchGestures() {
      const ptrEl = document.createElement('div');
      ptrEl.className = 'ptr-indicator';
      ptrEl.id = 'ptrBanner';
      ptrEl.innerHTML = `<i class="bi bi-arrow-repeat text-info"></i> <span id="ptrText">Puxe para sincronizar</span>`;
      document.body.appendChild(ptrEl);

      const mainMobileTabs = ['#tab-dashboard', '#tab-subjects', '#tab-pomodoro', '#tab-tasks'];
      let touchStartX = 0, touchStartY = 0, isIgnoredElement = false, isPullingTop = false;

      document.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        isPullingTop = (window.scrollY <= 5);
        isIgnoredElement = Boolean(
          e.target.closest('input[type="range"], .table-responsive, .heatmap-grid, .ace_editor, .modal.show, select, input, textarea')
        );
      }, { passive: true });

      document.addEventListener('touchmove', (e) => {
        if (!isPullingTop || isIgnoredElement || window.scrollY > 5) return;
        const dy = e.touches[0].clientY - touchStartY;
        const dx = Math.abs(e.touches[0].clientX - touchStartX);
        if (dy > 65 && dy > dx * 2) {
          ptrEl.classList.add('show');
          document.getElementById('ptrText').textContent = 'Solte para atualizar a Nuvem...';
        }
      }, { passive: true });

      document.addEventListener('touchend', async (e) => {
        if (isIgnoredElement || e.changedTouches.length !== 1) {
          ptrEl.classList.remove('show');
          return;
        }
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;

        if (isPullingTop && dy > 95 && Math.abs(dy) > Math.abs(dx) * 2) {
          triggerHaptic([15, 40, 20]);
          document.getElementById('ptrText').textContent = 'Sincronizando dados...';
          if (window.NexusCloud && NexusCloud.isSignedIn()) await NexusCloud.syncNow();
          else updateAllUI();
          setTimeout(() => ptrEl.classList.remove('show'), 700);
          return;
        }
        ptrEl.classList.remove('show');

        if (window.innerWidth <= 991 && Math.abs(dx) > 85 && Math.abs(dx) > Math.abs(dy) * 2.2) {
          const activePane = document.querySelector('.tab-content > .tab-pane.active');
          if (!activePane) return;
          const currentIndex = mainMobileTabs.indexOf(`#${activePane.id}`);
          if (currentIndex === -1) return;

          if (dx < 0 && currentIndex < mainMobileTabs.length - 1) {
            triggerHaptic(15);
            switchMobileTab(mainMobileTabs[currentIndex + 1]);
          } else if (dx > 0 && currentIndex > 0) {
            triggerHaptic(15);
            switchMobileTab(mainMobileTabs[currentIndex - 1]);
          }
        }
      }, { passive: true });
    })();

