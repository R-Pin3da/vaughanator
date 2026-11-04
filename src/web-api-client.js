(() => {
  const filesById = new Map();
  const createdAudioIdsByItem = new Map();
  const listeners = { stage: new Set(), result: new Set(), requestLog: new Set() };
  let session = null;

  const emit = (name, value) => listeners[name].forEach((callback) => {
    try { callback(value); } catch (error) { console.error('Error en listener de Vaughanator:', error); }
  });

  function subscribe(name, callback) {
    listeners[name].add(callback);
    return () => listeners[name].delete(callback);
  }

  function sanitizeUrl(value) {
    try {
      const url = new URL(String(value));
      const keys = [...new Set(url.searchParams.keys())];
      const query = keys.length ? `?${keys.map((key) => `${encodeURIComponent(key)}=[REDACTADO]`).join('&')}` : '';
      return `${url.origin}${url.pathname}${query}`;
    } catch {
      return '[URL no válida]';
    }
  }

  function sanitize(value, key = '') {
    if (/authorization|jwt|token|signature|credential|secret/i.test(key)) return '[REDACTADO]';
    if (typeof value === 'string') {
      if (/^https?:\/\//i.test(value)) return sanitizeUrl(value);
      return value.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTADO]')
        .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitizeUrl(url)).slice(0, 4000);
    }
    if (Array.isArray(value)) return value.map((item) => sanitize(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, sanitize(childValue, childKey)]));
    }
    return value;
  }

  function logRequest(url, options, label, extra = {}) {
    const headers = Object.fromEntries([...new Headers(options.headers).entries()].map(([key, value]) => [
      key,
      /authorization|token|signature|credential|secret/i.test(key) ? '[REDACTADO]' : value,
    ]));
    let body = options.body ?? null;
    if (body instanceof URLSearchParams) body = Object.fromEntries(body.entries());
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch {}
    }
    if (body instanceof Blob || body instanceof ArrayBuffer) body = '[cuerpo binario omitido]';
    emit('requestLog', {
      timestamp: new Date().toISOString(),
      type: 'request',
      method: options.method || 'GET',
      url: sanitizeUrl(url),
      headers,
      body: sanitize(body),
      label,
      ...extra,
    });
  }

  async function readResponse(response, label) {
    const raw = await response.text();
    let payload = null;
    if (raw) {
      try { payload = JSON.parse(raw); } catch { payload = raw; }
    }
    emit('requestLog', {
      timestamp: new Date().toISOString(),
      type: 'response',
      label,
      status: response.status,
      ok: response.ok,
      body: sanitize(payload),
    });
    if (!response.ok) {
      const detail = typeof payload === 'string'
        ? payload
        : payload?.message || payload?.error || payload?.detail || payload?.description;
      throw new Error(`${label} (${response.status}): ${String(detail || response.statusText || 'Error de API').slice(0, 600)}`);
    }
    return payload;
  }

  function networkError(error, label) {
    const message = error?.message || 'Error de red';
    emit('requestLog', { timestamp: new Date().toISOString(), type: 'response', label, error: message });
    if (error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(message)) {
      return new Error(`${label}: el navegador no pudo conectar. Comprueba la conexión y que API/servidor permitan CORS para el dominio de Vaughanator. (${message})`);
    }
    return error;
  }

  async function requestJson(url, options, label) {
    logRequest(url, options, label);
    let response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      throw networkError(error, label);
    }
    return readResponse(response, label);
  }

  function unwrap(payload) {
    return payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object'
      ? payload.data
      : payload;
  }

  async function validateUserToken(candidate) {
    const url = `${candidate.apiBaseUrl}/private/users/me`;
    const options = { method: 'GET', headers: { Authorization: `Bearer ${candidate.jwt}` } };
    logRequest(url, options, 'Validar JWT');
    let response;
    try {
      response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
    } catch (error) {
      throw networkError(error, 'Validar JWT');
    }
    const payload = await readResponse(response, 'Validar JWT');
    if (payload?.data?.id !== 39386) throw new Error('El JWT no está autorizado. La cuenta debe tener id 39386.');
  }

  async function setSession(input) {
    const jwt = String(input?.jwt || '').trim();
    if (!jwt) throw new Error('Introduce el JWT.');
    const environment = window.vaughanatorDomain.ENVIRONMENTS.find((item) => item.id === String(input.environment || ''));
    if (!environment) throw new Error('Selecciona un entorno válido.');
    const candidate = { jwt, apiBaseUrl: environment.apiBaseUrl, podcastBaseUrl: environment.podcastBaseUrl };
    await validateUserToken(candidate);
    session = candidate;
    return { ok: true, environmentName: environment.name };
  }

  function getSession() {
    if (!session?.jwt) throw new Error('La sesión ha terminado. Vuelve a introducir el JWT.');
    return session;
  }

  async function inspectFiles(fileList) {
    return Array.from(fileList || []).map((file) => {
      if (!(file instanceof File)) return { name: String(file?.name || ''), fileId: '', size: 0, error: 'La selección de archivos no es válida.' };
      const fileId = crypto.randomUUID();
      filesById.set(fileId, file);
      return { name: file.name, fileId, size: file.size, mimeType: file.type || 'audio/mpeg' };
    });
  }

  async function addAudioToList(item, audioId, activeSession) {
    if (!item.listId) throw new Error(`No hay un listId configurado para ${item.metadata?.label || 'este nivel'} en ${item.programName || 'este programa'}.`);
    return requestJson(`${activeSession.apiBaseUrl}/private/lists/add-audio`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${activeSession.jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ listId: String(item.listId), audioId: String(audioId) }),
    }, 'AddAudioToList');
  }

  function buildCreatePayload(item, uploadPayload) {
    const uploaded = unwrap(uploadPayload) || {};
    const uploadServer = uploaded.uploadServer ?? uploaded.upload_server ?? uploaded.server;
    const uploadReference = uploaded.uploadReference ?? uploaded.upload_reference ?? uploaded.reference ?? uploaded.ref ?? uploaded.id;
    if (uploaded.error !== undefined && Number(uploaded.error) !== 0) throw new Error(`UploadAudio indicó un error: ${String(uploaded.error)}.`);
    if (!uploadServer || !uploadReference) throw new Error('La respuesta de UploadAudio no incluye uploadServer y uploadReference. No se creó el audio.');
    const uploadExtension = uploaded.uploadExtension ?? uploaded.extension ?? uploaded.ext ?? '.mp3';
    return {
      programId: String(item.programId),
      title: item.title,
      description: item.description,
      subcategoryId: String(item.subcategoryId),
      genderId: String(item.genderId),
      languageId: String(item.languageId),
      image: item.image,
      listId: String(item.listId),
      schedule: true,
      scheduleDate: item.scheduleDate,
      type: item.type,
      tags: [...item.tags],
      iTunesType: item.iTunesType,
      iTunesSeason: 1,
      iTunesEpisode: item.episode,
      uploadServer: String(uploadServer),
      uploadReference: String(uploadReference),
      uploadExtension: String(uploadExtension),
    };
  }

  async function publishFile(item, file, activeSession, onStage) {
    if (!file) throw new Error('El MP3 ya no está disponible en la pestaña. Vuelve a añadirlo al lote.');
    const auth = { Authorization: `Bearer ${activeSession.jwt}` };
    onStage('presign');
    const presignResponse = await requestJson(`${activeSession.apiBaseUrl}/private/audios/upload/presigned-url`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    }, 'PresignUploadAudio');
    const presign = unwrap(presignResponse) || {};
    if (!presign.key || !presign.uploadUrl || !presign.downloadUrl) throw new Error('La respuesta presignada debe incluir key, uploadUrl y downloadUrl.');

    onStage('put');
    const uploadOptions = { method: 'PUT', headers: { 'Content-Type': file.type || 'audio/mpeg' }, body: file };
    logRequest(presign.uploadUrl, uploadOptions, 'Subir MP3 a S3', { fileName: file.name, fileSize: file.size });
    let uploadResponse;
    try {
      uploadResponse = await fetch(presign.uploadUrl, uploadOptions);
    } catch (error) {
      throw networkError(error, 'Subir MP3 a S3');
    }
    if (!uploadResponse.ok) {
      const body = await uploadResponse.text().catch(() => '');
      emit('requestLog', { timestamp: new Date().toISOString(), type: 'response', label: 'Subir MP3 a S3', fileName: file.name, status: uploadResponse.status, ok: false, body: sanitize(body) });
      throw new Error(`Subida PUT (${uploadResponse.status}): ${String(body || uploadResponse.statusText || 'Error al subir el MP3').slice(0, 600)}`);
    }
    emit('requestLog', { timestamp: new Date().toISOString(), type: 'response', label: 'Subir MP3 a S3', fileName: file.name, status: uploadResponse.status, ok: true });

    onStage('register');
    const form = new URLSearchParams({
      file: presign.downloadUrl,
      size: String(file.size),
      mimeType: file.type || 'audio/mpeg',
      programId: String(item.programId),
      noTranscription: '1',
    });
    const uploadPayload = await requestJson(`${activeSession.podcastBaseUrl}/ffmpeg/uploadHTML5.php`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    }, 'UploadAudio');

    onStage('create');
    const createdResponse = await requestJson(`${activeSession.apiBaseUrl}/private/audios`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildCreatePayload(item, uploadPayload)),
    }, 'CreatePodcasterAudio');
    const created = unwrap(createdResponse) || {};
    const audioId = created.id ?? created.audioId ?? created.audio_id ?? created.audio?.id;
    if (audioId === undefined || audioId === null || String(audioId).trim() === '') throw new Error('CreatePodcasterAudio no devolvió el ID del audio; no se puede añadir a la lista.');
    const normalizedId = String(audioId);
    createdAudioIdsByItem.set(item.id, normalizedId);
    onStage('list');
    await addAudioToList(item, normalizedId, activeSession);
    return normalizedId;
  }

  async function publishBatch(items, concurrency = 1) {
    const activeSession = getSession();
    if (!Array.isArray(items) || items.length === 0) return [];
    const requested = Number(concurrency);
    if (![1, 2, 4].includes(requested)) throw new Error('Selecciona un límite de paralelismo válido: 1, 2 o 4.');
    const results = new Array(items.length);
    let next = 0;
    async function work() {
      while (true) {
        const index = next++;
        if (index >= items.length) return;
        const item = items[index];
        const result = { id: item.id, status: 'error', message: '' };
        try {
          const createdId = createdAudioIdsByItem.get(item.id);
          if (createdId) {
            emit('stage', { id: item.id, stage: 'list' });
            await addAudioToList(item, createdId, activeSession);
          } else {
            const file = filesById.get(String(item.fileId || ''));
            await publishFile(item, file, activeSession, (stage) => emit('stage', { id: item.id, stage }));
          }
          createdAudioIdsByItem.delete(item.id);
          result.status = 'success';
          result.message = 'Audio creado, programado y añadido a su lista.';
        } catch (error) {
          result.message = error?.message || 'Error inesperado durante la subida.';
        }
        results[index] = result;
        emit('result', result);
      }
    }
    await Promise.all(Array.from({ length: Math.min(items.length, requested) }, () => work()));
    return results;
  }

  window.vaughanatorWeb = {
    setSession,
    clearSession: async () => { session = null; return { ok: true }; },
    inspectFiles,
    publishBatch,
    onStage: (callback) => subscribe('stage', callback),
    onItemResult: (callback) => subscribe('result', callback),
    onRequestLog: (callback) => subscribe('requestLog', callback),
  };

  window.addEventListener('pagehide', () => {
    session = null;
    filesById.clear();
    createdAudioIdsByItem.clear();
  });
})();
