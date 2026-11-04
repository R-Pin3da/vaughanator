const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ENVIRONMENTS } = require('../src/domain.js');

const clientSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'web-api-client.js'), 'utf8');

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => typeof payload === 'string' ? payload : JSON.stringify(payload),
  };
}

function createClient(fetchImpl) {
  let nextId = 0;
  class TestFile {
    constructor(name, bytes = 'mock-mp3', type = 'audio/mpeg') {
      this.name = name;
      this.size = Buffer.byteLength(bytes);
      this.type = type;
    }
  }
  const window = {
    vaughanatorDomain: { ENVIRONMENTS },
    addEventListener() {},
  };
  const sandbox = {
    window,
    fetch: fetchImpl,
    File: TestFile,
    Headers,
    URL,
    URLSearchParams,
    Blob,
    ArrayBuffer,
    AbortSignal,
    crypto: { randomUUID: () => `file-${++nextId}` },
    console,
    setTimeout,
  };
  vm.runInNewContext(clientSource, sandbox, { filename: 'web-api-client.js' });
  return { api: window.vaughanatorWeb, TestFile };
}

function item(id = 'publication-1') {
  return {
    id,
    fileId: 'file-1',
    name: 'BASICO 41.mp3',
    episode: 41,
    programId: '17145',
    programName: 'Drive Time',
    title: 'Episodio 41 Nivel Básico',
    description: 'Descripción',
    image: 'https://static-1.ivoox.com/cover.jpg',
    tags: ['Inglés'],
    listId: '11343355',
    subcategoryId: '51',
    genderId: '12',
    languageId: '3',
    type: 'FANS',
    iTunesType: 'full',
    scheduleDate: '2026-11-07 08:00:00',
  };
}

test('valida la sesión del navegador y oculta el JWT de los registros', async () => {
  const calls = [];
  const logs = [];
  let validationCount = 0;
  const { api } = createClient(async (url, options) => {
    calls.push({ url, options });
    validationCount += 1;
    return response({ data: { id: validationCount === 1 ? 39386 : 42 } });
  });
  api.onRequestLog((entry) => logs.push(entry));

  const session = await api.setSession({ jwt: 'browser-secret-token', environment: 'pre' });

  assert.equal(session.ok, true);
  assert.equal(session.environmentName, 'Pre');
  assert.equal(calls[0].url, 'https://core.ivoox.net/v1/private/users/me');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer browser-secret-token');
  assert.doesNotMatch(JSON.stringify(logs), /browser-secret-token/);
  await assert.rejects(api.setSession({ jwt: 'other-token', environment: 'pre' }), /id 39386/);
});

test('publica desde el navegador en orden y añade el audio a su lista', async () => {
  const calls = [];
  const stages = [];
  const logs = [];
  const { api, TestFile } = createClient(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/private/users/me')) return response({ data: { id: 39386 } });
    if (url.endsWith('/private/audios/upload/presigned-url')) {
      return response({ data: { key: 'object-key', uploadUrl: 'https://s3.example/upload?Signature=secret', downloadUrl: 'https://s3.example/file.mp3' } });
    }
    if (url.startsWith('https://s3.example/upload')) return response('');
    if (url.endsWith('/ffmpeg/uploadHTML5.php')) {
      assert.equal(options.body.get('programId'), '17145');
      assert.equal(options.body.get('mimeType'), 'audio/mpeg');
      return response({ data: { server: 'podcast102', ref: 'upload-id', ext: '.mp3', error: 0 } });
    }
    if (url.endsWith('/private/audios')) {
      const body = JSON.parse(options.body);
      assert.equal(body.image, 'https://static-1.ivoox.com/cover.jpg');
      assert.equal(body.uploadReference, 'upload-id');
      assert.equal(body.scheduleDate, '2026-11-07 08:00:00');
      return response({ id: 'created-audio' });
    }
    if (url.endsWith('/private/lists/add-audio')) {
      assert.deepEqual(JSON.parse(options.body), { listId: '11343355', audioId: 'created-audio' });
      return response({ ok: true });
    }
    throw new Error(`URL inesperada: ${url}`);
  });
  api.onStage(({ stage }) => stages.push(stage));
  api.onRequestLog((entry) => logs.push(entry));

  await api.setSession({ jwt: 'ephemeral-token', environment: 'pre' });
  const [file] = await api.inspectFiles([new TestFile('BASICO 41.mp3')]);
  const results = await api.publishBatch([{ ...item(), fileId: file.fileId }], 1);

  assert.equal(results[0].status, 'success');
  assert.deepEqual(stages, ['presign', 'put', 'register', 'create', 'list']);
  assert.deepEqual(calls.map(({ options }) => options.method), ['GET', 'POST', 'PUT', 'POST', 'POST', 'POST']);
  assert.doesNotMatch(JSON.stringify(logs), /ephemeral-token|Signature=secret/);
});

test('un error de CORS/red queda asociado al resultado y no rechaza toda la tanda', async () => {
  let createCount = 0;
  let putCount = 0;
  const { api, TestFile } = createClient(async (url) => {
    if (url.endsWith('/private/users/me')) return response({ data: { id: 39386 } });
    if (url.endsWith('/private/audios/upload/presigned-url')) return response({ data: { key: 'k', uploadUrl: 'https://s3.example/upload', downloadUrl: 'https://s3.example/file.mp3' } });
    if (url === 'https://s3.example/upload') {
      putCount += 1;
      if (putCount === 1) throw new TypeError('Failed to fetch');
      return response('');
    }
    if (url.endsWith('/ffmpeg/uploadHTML5.php')) return response({ data: { server: 'podcast102', ref: 'upload-id', ext: '.mp3', error: 0 } });
    if (url.endsWith('/private/audios')) {
      createCount += 1;
      return response({ id: `created-${createCount}` });
    }
    if (url.endsWith('/private/lists/add-audio')) return response({ ok: true });
    throw new Error(`URL inesperada: ${url}`);
  });
  await api.setSession({ jwt: 'token', environment: 'pre' });
  const [file] = await api.inspectFiles([new TestFile('BASICO 41.mp3')]);
  const results = await api.publishBatch([
    { ...item('failed'), fileId: file.fileId },
    { ...item('successful'), fileId: file.fileId },
  ], 1);

  assert.equal(results[0].status, 'error');
  assert.equal(results[1].status, 'success');
  assert.match(results[0].message, /CORS/);
  assert.equal(createCount, 1);
});
