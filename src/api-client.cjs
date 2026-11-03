const fs = require('node:fs');
const path = require('node:path');
const createdAudioIdsByItem = new Map();

function normalizeBaseUrl(value, label) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error(`${label}: introduce una URL completa, por ejemplo https://api.ivoox.com/v1.`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${label}: solo se permiten URLs HTTP o HTTPS.`);
  return url.toString().replace(/\/+$/, '');
}

function unwrapPayload(payload) {
  return payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object'
    ? payload.data
    : payload;
}

function getErrorMessage(payload, fallback) {
  if (typeof payload === 'string' && payload.trim()) return payload.trim().slice(0, 600);
  if (payload && typeof payload === 'object') {
    const message = payload.message || payload.error || payload.detail || payload.description;
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 600);
  }
  return fallback;
}

function sanitizeLogUrl(value) {
  try {
    const url = new URL(String(value));
    const queryKeys = [...url.searchParams.keys()];
    const query = queryKeys.length ? `?${[...new Set(queryKeys)].map((key) => `${encodeURIComponent(key)}=[REDACTADO]`).join('&')}` : '';
    return `${url.origin}${url.pathname}${query}`;
  } catch {
    return '[URL no válida]';
  }
}

function sanitizeLogValue(value, key = '') {
  if (/authorization|jwt|token|signature|credential|secret/i.test(key)) return '[REDACTADO]';
  if (typeof value === 'string') {
    if (/url|file/i.test(key) && /^https?:\/\//i.test(value)) return sanitizeLogUrl(value);
    if (/^https?:\/\//i.test(value)) return sanitizeLogUrl(value);
    return value
      .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTADO]')
      .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitizeLogUrl(url))
      .slice(0, 4000);
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeLogValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, sanitizeLogValue(childValue, childKey)]));
  }
  return value;
}

function summarizeRequestBody(body) {
  if (body == null) return null;
  if (body instanceof URLSearchParams) return sanitizeLogValue(Object.fromEntries(body.entries()));
  if (typeof body === 'string') {
    try { return sanitizeLogValue(JSON.parse(body)); } catch { return body.slice(0, 4000); }
  }
  if (Buffer.isBuffer(body) || typeof body.pipe === 'function' || typeof body.getReader === 'function') {
    return '[cuerpo binario/stream omitido]';
  }
  return sanitizeLogValue(body);
}

function emitRequestLog(onRequestLog, entry) {
  if (typeof onRequestLog !== 'function') return;
  try { onRequestLog({ timestamp: new Date().toISOString(), ...entry }); } catch {}
}

function logRequest(onRequestLog, url, options, extra = {}) {
  const headers = Object.fromEntries(Object.entries(options.headers || {}).map(([key, value]) => [
    key,
    /authorization|token|signature|credential|secret/i.test(key) ? '[REDACTADO]' : String(value),
  ]));
  emitRequestLog(onRequestLog, {
    type: 'request',
    method: options.method || 'GET',
    url: sanitizeLogUrl(url),
    headers,
    body: summarizeRequestBody(options.body),
    ...extra,
  });
}

async function readResponse(response, label, onRead = () => {}) {
  const raw = await response.text();
  let payload = null;
  if (raw) {
    try { payload = JSON.parse(raw); } catch { payload = raw; }
  }
  onRead({ status: response.status, ok: response.ok, body: sanitizeLogValue(payload) });
  if (!response.ok) {
    throw new Error(`${label} (${response.status}): ${getErrorMessage(payload, response.statusText || 'Error de API')}`);
  }
  return payload;
}

async function validateUserToken({ jwt, apiBaseUrl, fetchImpl = globalThis.fetch, onRequestLog = () => {} }) {
  const token = String(jwt || '').trim();
  if (!token) throw new Error('Introduce el JWT.');
  const apiBase = normalizeBaseUrl(apiBaseUrl, 'API base URL');
  const url = `${apiBase}/private/users/me`;
  const options = {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  };
  logRequest(onRequestLog, url, options, { label: 'Validar JWT' });
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch (error) {
    emitRequestLog(onRequestLog, { type: 'response', label: 'Validar JWT', error: error?.message || 'Error de red' });
    throw error;
  }
  const payload = await readResponse(response, 'Validación del JWT', (details) => emitRequestLog(onRequestLog, { type: 'response', label: 'Validar JWT', ...details }));
  const userId = payload?.data?.id;
  if (userId !== 39386) {
    throw new Error('El JWT no está autorizado. La cuenta debe tener id 39386.');
  }
  return { userId };
}

async function requestJson({ url, options, label, fetchImpl, onRequestLog }) {
  logRequest(onRequestLog, url, options, { label });
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch (error) {
    emitRequestLog(onRequestLog, { type: 'response', label, error: error?.message || 'Error de red' });
    throw error;
  }
  return readResponse(response, label, (details) => emitRequestLog(onRequestLog, { type: 'response', label, ...details }));
}

function getCreatedAudioId(createPayload) {
  const created = unwrapPayload(createPayload) || {};
  const audioId = created.id ?? created.audioId ?? created.audio_id ?? created.audio?.id;
  if (audioId === undefined || audioId === null || String(audioId).trim() === '') {
    throw new Error('CreatePodcasterAudio no devolvió el ID del audio; no se puede añadir a la lista.');
  }
  return String(audioId);
}

async function addAudioToList({ item, audioId, session, fetchImpl = globalThis.fetch, onRequestLog = () => {} }) {
  if (!item.listId) throw new Error(`No hay un listId configurado para ${item.metadata?.label || 'este nivel'} en ${item.programName || 'este programa'}.`);
  const apiBase = normalizeBaseUrl(session.apiBaseUrl, 'API base URL');
  const token = String(session.jwt || '').trim();
  if (!token) throw new Error('Introduce el JWT antes de añadir el audio a la lista.');

  return requestJson({
    url: `${apiBase}/private/lists/add-audio`,
    options: {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ listId: String(item.listId), audioId: String(audioId) }),
    },
    label: 'AddAudioToList',
    fetchImpl,
    onRequestLog,
  });
}

function buildCreatePayload(item, uploadPayload) {
  if (!item.listId) throw new Error(`No hay un listId configurado para ${item.metadata?.label || 'este nivel'} en ${item.programName || 'este programa'}.`);
  const uploaded = unwrapPayload(uploadPayload) || {};
  const uploadServer = uploaded.uploadServer ?? uploaded.upload_server ?? uploaded.server;
  const uploadReference = uploaded.uploadReference ?? uploaded.upload_reference ?? uploaded.reference ?? uploaded.ref ?? uploaded.id;
  if (uploaded.error !== undefined && Number(uploaded.error) !== 0) {
    throw new Error(`UploadAudio indicó un error: ${String(uploaded.error)}.`);
  }
  if (!uploadServer || !uploadReference) {
    throw new Error('La respuesta de uploadHTML5 no incluye uploadServer y uploadReference. No se creó el audio.');
  }
  const uploadExtension = uploaded.uploadExtension ?? uploaded.extension ?? uploaded.ext ?? path.extname(uploaded.name || item.name).toLowerCase();

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

async function putFile(uploadUrl, file, fetchImpl = globalThis.fetch, onRequestLog = () => {}) {
  const headers = {
    'content-type': file.mimeType || 'audio/mpeg',
    'content-length': String(file.size),
  };
  const options = {
    method: 'PUT',
    headers,
    body: fs.createReadStream(file.path),
    duplex: 'half',
  };
  logRequest(onRequestLog, uploadUrl, options, { label: 'Subir MP3 a S3', fileName: file.name, fileSize: file.size });
  let response;
  try {
    response = await fetchImpl(uploadUrl, options);
  } catch (error) {
    emitRequestLog(onRequestLog, { type: 'response', label: 'Subir MP3 a S3', fileName: file.name, error: error?.message || 'Error de red' });
    throw error;
  }
  if (response.ok) {
    emitRequestLog(onRequestLog, { type: 'response', label: 'Subir MP3 a S3', fileName: file.name, status: response.status, ok: true });
    return;
  }
  const text = await response.text().catch(() => '');
  emitRequestLog(onRequestLog, { type: 'response', label: 'Subir MP3 a S3', fileName: file.name, status: response.status, ok: false, body: sanitizeLogValue(text) });
  throw new Error(`Subida PUT (${response.status}): ${getErrorMessage(text, response.statusText || 'Error al subir el MP3')}`);
}

async function publishFile({ file, item, session, fetchImpl = globalThis.fetch, uploadImpl = putFile, onStage = () => {}, onCreatedAudio = () => {}, onRequestLog = () => {} }) {
  const apiBase = normalizeBaseUrl(session.apiBaseUrl, 'API base URL');
  const podcastBase = normalizeBaseUrl(session.podcastBaseUrl, 'Podcast base URL');
  const token = String(session.jwt || '').trim();
  if (!token) throw new Error('Introduce el JWT antes de enviar el lote.');
  if (!fs.existsSync(file.path)) throw new Error('No se encuentra el archivo MP3 en su ubicación original.');

  const stat = fs.statSync(file.path);
  const mimeType = file.mimeType || 'audio/mpeg';
  const authorization = { Authorization: `Bearer ${token}` };
  onStage('presign');
  const presignPayload = await requestJson({
    url: `${apiBase}/private/audios/upload/presigned-url`,
    options: { method: 'POST', headers: { ...authorization, 'Content-Type': 'application/json' } },
    label: 'PresignUploadAudio', fetchImpl, onRequestLog,
  });
  const presign = unwrapPayload(presignPayload) || {};
  if (!presign.key || !presign.uploadUrl || !presign.downloadUrl) {
    throw new Error('La respuesta presignada debe incluir key, uploadUrl y downloadUrl.');
  }

  onStage('put');
  await uploadImpl(presign.uploadUrl, { path: file.path, name: file.name, mimeType, size: stat.size }, fetchImpl, onRequestLog);

  onStage('register');
  const form = new URLSearchParams();
  form.set('file', presign.downloadUrl);
  form.set('size', String(stat.size));
  form.set('mimeType', mimeType);
  form.set('programId', String(item.programId));
  const uploadPayload = await requestJson({
    url: `${podcastBase}/ffmpeg/uploadHTML5.php`,
    options: {
      method: 'POST',
      headers: { ...authorization, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    },
    label: 'UploadAudio', fetchImpl, onRequestLog,
  });

  onStage('create');
  const createPayload = buildCreatePayload(item, uploadPayload);
  const created = await requestJson({
    url: `${apiBase}/private/audios`,
    options: {
      method: 'POST',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify(createPayload),
    },
    label: 'CreatePodcasterAudio', fetchImpl, onRequestLog,
  });

  const audioId = getCreatedAudioId(created);
  onCreatedAudio(audioId);
  onStage('list');
  await addAudioToList({ item, audioId, session, fetchImpl, onRequestLog });

  return { created, audioId, objectKey: presign.key };
}

async function publishBatch({ items, concurrency = 1, resolveFile, session, fetchImpl = globalThis.fetch, uploadImpl = putFile, onStage = () => {}, onResult = () => {}, onRequestLog = () => {} }) {
  if (!Array.isArray(items)) throw new Error('El lote no contiene una lista de publicaciones válida.');
  if (items.length === 0) return [];

  const requestedConcurrency = concurrency === 'all' ? items.length : Number(concurrency);
  if (![1, 2, 4, 8].includes(requestedConcurrency) && concurrency !== 'all') {
    throw new Error('Selecciona un límite de paralelismo válido: 1, 2, 4, 8 o Todos.');
  }
  const workerCount = Math.min(items.length, requestedConcurrency);
  const results = new Array(items.length);
  let nextIndex = 0;

  async function processNext() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;

      const item = items[index];
      const result = { id: item.id, status: 'error', message: '' };
      try {
        const existingAudioId = createdAudioIdsByItem.get(item.id);
        if (existingAudioId) {
          onStage(item, 'list');
          await addAudioToList({ item, audioId: existingAudioId, session, fetchImpl, onRequestLog: (entry) => onRequestLog(item, entry) });
        } else {
          const file = await resolveFile(item);
          await publishFile({
            file,
            item,
            session,
            fetchImpl,
            uploadImpl,
            onStage: (stage) => onStage(item, stage),
            onCreatedAudio: (audioId) => createdAudioIdsByItem.set(item.id, audioId),
            onRequestLog: (entry) => onRequestLog(item, entry),
          });
        }
        createdAudioIdsByItem.delete(item.id);
        result.status = 'success';
        result.message = 'Audio creado, programado y añadido a su lista.';
      } catch (error) {
        result.message = error?.message || 'Error inesperado durante la subida.';
      }
      results[index] = result;
      onResult(result);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => processNext()));
  return results;
}

module.exports = {
  buildCreatePayload,
  normalizeBaseUrl,
  publishBatch,
  publishFile,
  putFile,
  readResponse,
  unwrapPayload,
  validateUserToken,
};
