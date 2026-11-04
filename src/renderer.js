(() => {
  const domain = window.vaughanatorDomain;
  const api = window.vaughanatorWeb;
  const state = {
    sessionActive: false,
    files: [],
    preview: [],
    batchRunning: false,
    locked: false,
    statuses: new Map(),
    scheduleOverrides: new Map(),
    requestLogs: [],
  };

  const byId = (id) => document.getElementById(id);
  const elements = {
    sessionForm: byId('session-form'),
    jwt: byId('jwt'),
    environment: byId('environment'),
    loginLink: byId('login-link'),
    zpLink: byId('zp-link'),
    tokenCommand: byId('token-command-text'),
    copyTokenCommand: byId('copy-token-command'),
    sessionSubmit: byId('session-submit'),
    sessionMessage: byId('session-message'),
    sessionIndicator: byId('session-indicator'),
    sessionLabel: byId('session-label'),
    startDate: byId('start-date'),
    dropzone: byId('dropzone'),
    fileInput: byId('file-input'),
    batchErrors: byId('batch-errors'),
    emptyState: byId('empty-state'),
    audioList: byId('audio-list'),
    fileCount: byId('file-count'),
    resultSummary: byId('result-summary'),
    clearBatch: byId('clear-batch'),
    parallelLimit: byId('parallel-limit'),
    publish: byId('publish'),
    requestLogDetails: byId('request-log-details'),
    requestLogCount: byId('request-log-count'),
    requestLogOutput: byId('request-log-output'),
    copyRequestLog: byId('copy-request-log'),
    clearRequestLog: byId('clear-request-log'),
  };

  const stageLabels = {
    presign: 'Preparando subida',
    put: 'Subiendo MP3',
    register: 'Registrando archivo',
    create: 'Creando audio',
    list: 'Añadiendo a lista',
  };

  function dateInputValue(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function nextSaturday() {
    const date = new Date();
    const untilSaturday = (6 - date.getDay() + 7) % 7 || 7;
    date.setDate(date.getDate() + untilSaturday);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function showSessionMessage(message = '', tone = '') {
    elements.sessionMessage.textContent = message;
    elements.sessionMessage.className = `inline-message${tone ? ` ${tone}` : ''}`;
  }

  function updateEnvironmentLinks() {
    const suffix = elements.environment.value === 'production' ? 'com' : 'net';
    const base = `https://www.ivoox.${suffix}`;
    elements.loginLink.href = `${base}/`;
    elements.zpLink.href = `${base}/_ra_2830059_1.html`;
  }

  async function copyTokenCommand() {
    const command = elements.tokenCommand.textContent;
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      const temporary = document.createElement('textarea');
      temporary.value = command;
      temporary.style.position = 'fixed';
      temporary.style.opacity = '0';
      document.body.append(temporary);
      temporary.select();
      document.execCommand('copy');
      temporary.remove();
    }
    const originalText = elements.copyTokenCommand.textContent;
    elements.copyTokenCommand.textContent = 'Copiado';
    setTimeout(() => { elements.copyTokenCommand.textContent = originalText; }, 1200);
  }

  function renderRequestLog() {
    elements.requestLogCount.textContent = String(state.requestLogs.length);
    elements.copyRequestLog.disabled = state.requestLogs.length === 0;
    elements.clearRequestLog.disabled = state.requestLogs.length === 0;
    elements.requestLogOutput.textContent = state.requestLogs.length
      ? state.requestLogs.map((entry) => JSON.stringify(entry, null, 2)).join('\n\n')
      : 'Aún no hay requests registrados.';
  }

  async function copyRequestLog() {
    const text = state.requestLogs.map((entry) => JSON.stringify(entry, null, 2)).join('\n\n');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const temporary = document.createElement('textarea');
      temporary.value = text;
      temporary.style.position = 'fixed';
      temporary.style.opacity = '0';
      document.body.append(temporary);
      temporary.select();
      document.execCommand('copy');
      temporary.remove();
    }
    const originalText = elements.copyRequestLog.textContent;
    elements.copyRequestLog.textContent = 'Copiado';
    setTimeout(() => { elements.copyRequestLog.textContent = originalText; }, 1200);
  }

  function setSessionActive(active, environmentName = '') {
    state.sessionActive = active;
    elements.sessionIndicator.classList.toggle('active', active);
    elements.sessionLabel.textContent = active ? `Sesión activa · ${environmentName} · solo memoria` : 'Sesión sin iniciar';
    elements.sessionSubmit.innerHTML = active
      ? 'Actualizar sesión <span aria-hidden="true">↻</span>'
      : 'Iniciar sesión <span aria-hidden="true">→</span>';
    elements.startDate.disabled = !active || state.batchRunning || state.locked;
    elements.environment.disabled = state.batchRunning || state.locked;
    elements.fileInput.disabled = state.batchRunning || state.locked;
    elements.parallelLimit.disabled = state.batchRunning || state.locked;
    elements.dropzone.classList.toggle('locked', state.locked);
    render();
  }

  function collectValidation() {
    const result = domain.validateBatch(state.files);
    const errors = [...result.errors];
    let preview = [];
    if (result.files.length && result.episodes.length) {
      const firstEpisode = result.episodes[0];
      try {
        const episodeSlots = new Map();
        preview = result.files.flatMap((file) => {
          const slotIndex = episodeSlots.get(file.episode) || 0;
          episodeSlots.set(file.episode, slotIndex + 1);
          return domain.makePublicationItems(file, elements.startDate.value, firstEpisode, slotIndex)
            .map((item) => {
              const id = `${file.id}:${item.programId}`;
              const scheduleDate = state.scheduleOverrides.get(id);
              return { ...item, id, sourceId: file.id, scheduleDate: scheduleDate || item.scheduleDate };
            });
        });
        const missingLists = [...new Set(preview
          .filter((item) => !item.listId)
          .map((item) => `${item.metadata.label} · ${item.programName}`))];
        if (missingLists.length) {
          errors.push({ file: null, message: `Falta configurar el ID de lista del Excel para: ${missingLists.join('; ')}.` });
        }
        const schedule = domain.validateSchedule(preview);
        if (!schedule.ok) errors.push({ file: null, message: schedule.message });
      } catch (error) {
        errors.push({ file: null, message: error.message });
      }
    }
    state.preview = preview;
    return { ...result, errors, preview };
  }

  function formatSize(size) {
    if (!Number.isFinite(size)) return '—';
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function removeSourceFiles(predicate) {
    const removed = state.files.filter(predicate);
    if (!removed.length) return;
    const removedIds = new Set(removed.map((file) => file.id));
    state.files = state.files.filter((file) => !removedIds.has(file.id));
    for (const file of removed) {
      state.statuses.delete(file.id);
      for (const program of domain.PROGRAMS) {
        const publicationId = `${file.id}:${program.id}`;
        state.statuses.delete(publicationId);
        state.scheduleOverrides.delete(publicationId);
      }
    }
  }

  function appendErrorList(validation) {
    elements.batchErrors.replaceChildren();
    if (!validation.errors.length) {
      elements.batchErrors.hidden = true;
      return;
    }
    elements.batchErrors.hidden = false;
    const heading = document.createElement('strong');
    heading.textContent = 'Revisa el lote antes de continuar';
    const list = document.createElement('ul');
    validation.errors.forEach((error) => {
      const item = document.createElement('li');
      item.textContent = error.file ? `${error.file}: ${error.message}` : error.message;
      if (error.file) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'error-remove';
        remove.textContent = 'Quitar archivo';
        remove.addEventListener('click', () => {
          removeSourceFiles((file) => file.name === error.file);
          render();
        });
        item.append(' ');
        item.append(remove);
      }
      list.append(item);
    });
    elements.batchErrors.append(heading, list);
  }

  function makeAudioRow(item) {
    const row = document.createElement('article');
    row.className = 'audio-row';
    row.dataset.id = item.id;

    const cover = document.createElement('div');
    cover.className = 'cover';
    const image = document.createElement('img');
    image.src = item.image;
    image.alt = `Portada ${item.metadata.label}`;
    image.referrerPolicy = 'no-referrer';
    cover.append(image);

    const titleBlock = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'audio-title';
    title.title = item.title;
    title.textContent = item.title;
    const filename = document.createElement('div');
    filename.className = 'audio-name';
    filename.title = item.name;
    filename.textContent = item.name;
    titleBlock.append(title, filename);

    const levelBlock = document.createElement('div');
    const level = document.createElement('div');
    level.className = 'level-chip';
    const swatch = document.createElement('span');
    swatch.className = `level-swatch ${item.metadata.key}`;
    const levelName = document.createElement('span');
    levelName.textContent = `${item.programName} · ${item.metadata.label} · Ep. ${item.episode}`;
    level.append(swatch, levelName);
    const size = document.createElement('div');
    size.className = 'file-size';
    size.textContent = formatSize(item.size);
    levelBlock.append(level, size);

    const schedule = document.createElement('input');
    schedule.className = 'schedule-input';
    schedule.type = 'datetime-local';
    schedule.step = '1';
    schedule.value = domain.scheduleToInputValue(item.scheduleDate);
    schedule.setAttribute('aria-label', `Fecha y hora de publicación de ${item.name} en ${item.programName}`);
    schedule.title = 'Fecha y hora local de publicación';
    schedule.disabled = state.batchRunning || state.locked;
    schedule.addEventListener('change', () => {
      const value = domain.scheduleFromInputValue(schedule.value);
      if (value) state.scheduleOverrides.set(item.id, value);
      else state.scheduleOverrides.delete(item.id);
      render();
    });

    const status = document.createElement('span');
    const currentStatus = state.statuses.get(item.id) || { status: 'queued', message: 'Pendiente' };
    status.className = `row-status ${currentStatus.status === 'working' ? 'working' : currentStatus.status}`;
    status.textContent = currentStatus.status === 'working'
      ? stageLabels[currentStatus.stage] || 'Procesando'
      : currentStatus.message;
    status.title = currentStatus.message || '';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-row';
    remove.textContent = '×';
    remove.title = 'Quitar este MP3 del lote y retirar sus cuatro publicaciones';
    remove.disabled = state.batchRunning || state.locked;
    remove.addEventListener('click', () => {
      removeSourceFiles((file) => file.id === item.sourceId);
      render();
    });

    const description = document.createElement('details');
    description.className = 'description-detail';
    const summary = document.createElement('summary');
    summary.textContent = `Descripción · ${item.programName}`;
    const text = document.createElement('p');
    text.textContent = item.description;
    description.append(summary, text);

    row.append(cover, titleBlock, levelBlock, schedule, status, remove, description);
    return row;
  }

  function render() {
    const validation = collectValidation();
    elements.startDate.disabled = !state.sessionActive || state.batchRunning || state.locked;
    elements.fileInput.disabled = state.batchRunning || state.locked;
    elements.parallelLimit.disabled = state.batchRunning || state.locked;
    elements.dropzone.classList.toggle('locked', state.locked);
    appendErrorList(validation);
    elements.audioList.replaceChildren();
    validation.preview.forEach((item) => elements.audioList.append(makeAudioRow(item)));
    const hasRows = validation.preview.length > 0;
    elements.emptyState.hidden = hasRows;
    elements.fileCount.textContent = String(validation.preview.length);
    const pendingItems = validation.preview.filter((item) => state.statuses.get(item.id)?.status !== 'success');
    elements.clearBatch.disabled = state.files.length === 0 || state.batchRunning || state.locked;
    elements.publish.disabled = !state.sessionActive || !hasRows || validation.errors.length > 0 || state.batchRunning || pendingItems.length === 0;
    elements.publish.innerHTML = state.locked && pendingItems.length
      ? 'Reintentar fallidos <span aria-hidden="true">↻</span>'
      : 'Confirmar y publicar <span aria-hidden="true">→</span>';

    if (state.batchRunning) {
      elements.resultSummary.className = 'result-summary';
      elements.resultSummary.textContent = 'Lote en curso. No cierres esta pestaña.';
    } else if (state.files.length === 0) {
      elements.resultSummary.className = 'result-summary';
      elements.resultSummary.textContent = 'No hay audios seleccionados.';
    } else if (validation.errors.length) {
      elements.resultSummary.className = 'result-summary error';
      elements.resultSummary.textContent = 'El lote tiene errores de validación.';
    } else if (state.locked) {
      const completed = validation.preview.filter((item) => state.statuses.get(item.id)?.status === 'success').length;
      const failed = validation.preview.filter((item) => state.statuses.get(item.id)?.status === 'error').length;
      elements.resultSummary.className = `result-summary${failed ? ' error' : ' success'}`;
      elements.resultSummary.textContent = `${completed} publicado(s) · ${failed} con error${failed ? ' · puedes reintentar solo los fallidos' : ''}`;
    } else {
      const bytes = state.files.reduce((total, file) => total + (file.size || 0), 0);
      elements.resultSummary.className = 'result-summary';
      elements.resultSummary.textContent = `${state.files.length} MP3 · ${validation.preview.length} publicaciones previstas · ${formatSize(bytes)} · 4 programas por audio`;
    }
  }

  async function addFiles(fileList) {
    if (state.locked || state.batchRunning) return;
    const files = Array.from(fileList || []);
    if (!files.length) return;
    try {
      const inspected = await api.inspectFiles(files);
      const knownFiles = new Set(state.files.map((file) => file.fileId));
      const additions = inspected
        .filter((file) => !file.error && !knownFiles.has(file.fileId))
        .map((file) => ({ ...file, id: crypto.randomUUID() }));
      if (!additions.length) return;
      state.files = [...state.files, ...additions];
      additions.forEach((file) => state.statuses.set(file.id, { status: 'queued', message: 'Pendiente' }));
      render();
    } catch (error) {
      elements.resultSummary.className = 'result-summary error';
      elements.resultSummary.textContent = error.message || 'No se pudieron leer los archivos.';
    } finally {
      elements.fileInput.value = '';
    }
  }

  async function onSessionSubmit(event) {
    event.preventDefault();
    const jwt = elements.jwt.value.trim();
    if (!jwt) {
      showSessionMessage('Introduce el JWT de iVoox.', 'error');
      return;
    }
    elements.sessionSubmit.disabled = true;
    showSessionMessage('Validando JWT con iVoox…');
    try {
      await api.setSession({
        jwt,
        environment: elements.environment.value,
      });
      elements.jwt.value = '';
      const environmentName = elements.environment.selectedOptions[0]?.textContent || 'Pre';
      setSessionActive(true, environmentName);
      showSessionMessage(`JWT validado para el usuario permitido. Entorno: ${environmentName}. El token solo vive en memoria.`, 'success');
    } catch (error) {
      showSessionMessage(error.message || 'No se pudo iniciar la sesión.', 'error');
    } finally {
      elements.sessionSubmit.disabled = false;
    }
  }

  async function onEnvironmentChange() {
    if (!state.sessionActive) return;
    try {
      await api.clearSession();
      setSessionActive(false);
      showSessionMessage('Has cambiado de entorno. Introduce de nuevo el JWT para conectar.', '');
    } catch (error) {
      showSessionMessage(error.message || 'No se pudo cerrar la sesión actual.', 'error');
    }
  }

  async function publishBatch() {
    const validation = collectValidation();
    if (!state.sessionActive || validation.errors.length || !validation.preview.length) return;
    state.batchRunning = true;
    state.locked = true;
    const pendingItems = validation.preview.filter((item) => state.statuses.get(item.id)?.status !== 'success');
    pendingItems.forEach((item) => state.statuses.set(item.id, { status: 'queued', message: 'En cola' }));
    render();
    try {
      const results = await api.publishBatch(pendingItems.map((item) => ({
        ...item,
        fileId: state.files.find((file) => file.id === item.sourceId)?.fileId,
      })), elements.parallelLimit.value);
      const failures = results.filter((result) => result.status !== 'success');
      if (failures.length) {
        const details = failures.map((result) => {
          const item = state.preview.find((candidate) => candidate.id === result.id);
          return `${item ? `${item.name} → ${item.programName}` : result.id}: ${result.message}`;
        }).join('\n');
        window.alert(`${failures.length} publicación(es) no se pudieron crear. El resto del lote se procesó.\n\n${details}`);
      } else {
        window.alert(`Lote completado: ${results.length} publicación(es) creada(s) y programada(s).`);
      }
    } catch (error) {
      pendingItems.forEach((item) => state.statuses.set(item.id, { status: 'error', message: error.message || 'No se pudo procesar el lote.' }));
      window.alert(error.message || 'No se pudo procesar el lote.');
    } finally {
      state.batchRunning = false;
      render();
    }
  }

  function initialize() {
    domain.ENVIRONMENTS.forEach((environment) => {
      const option = document.createElement('option');
      option.value = environment.id;
      option.textContent = environment.name;
      option.selected = environment.id === domain.DEFAULT_ENVIRONMENT_ID;
      elements.environment.append(option);
    });
    elements.startDate.value = dateInputValue(nextSaturday());
    elements.startDate.min = dateInputValue(new Date());

    elements.sessionForm.addEventListener('submit', onSessionSubmit);
    elements.environment.addEventListener('change', onEnvironmentChange);
    elements.environment.addEventListener('change', updateEnvironmentLinks);
    elements.copyTokenCommand.addEventListener('click', copyTokenCommand);
    updateEnvironmentLinks();
    elements.startDate.addEventListener('change', render);
    elements.fileInput.addEventListener('change', (event) => addFiles(event.target.files));
    elements.dropzone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        elements.fileInput.click();
      }
    });
    ['dragenter', 'dragover'].forEach((name) => elements.dropzone.addEventListener(name, (event) => {
      event.preventDefault();
      elements.dropzone.classList.add('dragging');
    }));
    ['dragleave', 'drop'].forEach((name) => elements.dropzone.addEventListener(name, (event) => {
      event.preventDefault();
      elements.dropzone.classList.remove('dragging');
    }));
    elements.dropzone.addEventListener('drop', (event) => addFiles(event.dataTransfer.files));
    elements.clearBatch.addEventListener('click', () => {
      state.files = [];
      state.statuses.clear();
      state.scheduleOverrides.clear();
      render();
    });
    elements.publish.addEventListener('click', publishBatch);
    elements.parallelLimit.addEventListener('change', render);
    elements.copyRequestLog.addEventListener('click', copyRequestLog);
    elements.clearRequestLog.addEventListener('click', () => {
      state.requestLogs = [];
      renderRequestLog();
    });

    api.onStage(({ id, stage }) => {
      state.statuses.set(id, { status: 'working', stage, message: stageLabels[stage] || 'Procesando' });
      render();
    });
    api.onItemResult((result) => {
      state.statuses.set(result.id, { status: result.status, message: result.message });
      render();
    });
    api.onRequestLog((entry) => {
      state.requestLogs.push(entry);
      renderRequestLog();
      if (entry.type === 'response' && (!entry.ok || entry.error)) elements.requestLogDetails.open = true;
    });
    renderRequestLog();
    render();
  }

  initialize();
})();
