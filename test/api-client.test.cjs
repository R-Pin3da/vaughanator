const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { buildCreatePayload, publishBatch, publishFile, putFile, validateUserToken } = require('../src/api-client.cjs');
const { PROGRAMS } = require('../src/domain.js');

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => typeof payload === 'string' ? payload : JSON.stringify(payload),
  };
}

function testItem() {
  return {
    id: 'view-id',
    name: 'BASICO 41.mp3',
    episode: 41,
    programId: '17145',
    title: 'Episodio 41 Nivel Básico - Vaughan Inglés 4.0 Podcast',
    description: 'Descripción',
    image: 'https://static-1.ivoox.com/audios/0/d/9/d/0d9dbd87327e914b72f54b8361123cf4_XXL.jpg',
    tags: ['Aprender inglés', 'Inglés básico'],
    listId: '11343355',
    subcategoryId: '51',
    genderId: '12',
    languageId: '3',
    type: 'FANS',
    iTunesType: 'full',
    scheduleDate: '2026-11-07 08:00:00',
  };
}

test('valida el JWT con /private/users/me y permite solo el usuario 39386', async () => {
  let request;
  const logs = [];
  const valid = await validateUserToken({
    jwt: 'session-token',
    apiBaseUrl: 'https://core.ivoox.net/v1',
    onRequestLog: (entry) => logs.push(entry),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({ data: { id: 39386, name: 'Cuenta permitida' } });
    },
  });
  assert.deepEqual(valid, { userId: 39386 });
  assert.equal(request.url, 'https://core.ivoox.net/v1/private/users/me');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.headers.Authorization, 'Bearer session-token');
  assert.equal(logs[0].headers.Authorization, '[REDACTADO]');
  assert.doesNotMatch(JSON.stringify(logs), /session-token/);

  await assert.rejects(validateUserToken({
    jwt: 'other-token',
    apiBaseUrl: 'https://core.ivoox.net/v1',
    fetchImpl: async () => response({ data: { id: 42 } }),
  }), /id 39386/);
});

test('buildCreatePayload mapea respuesta UploadAudio y envía URL completa en image', () => {
  const uploadResponse = {
    data: {
      server: 'podcast102',
      ref: '1793705076957239386',
      req: 'POST',
      name: 'bc6e8c04-062d-44e6-8ff8-9104bebf52d8.mp3',
      type: 'audio/mpeg',
      size: 71558871,
      error: 0,
      ext: '.mp3',
      s3Deleted: true,
    },
  };
  const payload = buildCreatePayload(testItem(), uploadResponse);
  assert.equal(payload.uploadServer, 'podcast102');
  assert.equal(payload.uploadReference, '1793705076957239386');
  assert.equal(payload.uploadExtension, '.mp3');
  assert.equal(payload.image, testItem().image);
  assert.equal(payload.schedule, true);
  assert.equal(payload.iTunesEpisode, 41);
  assert.equal(payload.type, 'FANS');
});

test('no crea el audio si UploadAudio devuelve error distinto de cero', () => {
  assert.throws(() => buildCreatePayload(testItem(), {
    data: { server: 'podcast102', ref: 'upload-ref', ext: '.mp3', error: 1 },
  }), /UploadAudio indicó un error/);
});

test('publica en el orden presign, PUT, UploadAudio y CreatePodcasterAudio', async (t) => {
  const filePath = path.join(os.tmpdir(), `vaughanator-${process.pid}-${Date.now()}.mp3`);
  fs.writeFileSync(filePath, Buffer.from('mock-mp3'));
  t.after(() => fs.rmSync(filePath, { force: true }));

  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/private/audios/upload/presigned-url')) {
      return response({ data: { key: 'key', uploadUrl: 'https://s3.example/upload', downloadUrl: 'https://s3.example/file.mp3' } });
    }
    if (url.endsWith('/ffmpeg/uploadHTML5.php')) {
      assert.equal(options.method, 'POST');
      assert.match(options.headers['Content-Type'], /application\/x-www-form-urlencoded/);
      assert.equal(options.body.get('programId'), '17145');
      assert.equal(options.body.get('mimeType'), 'audio/mpeg');
      return response({ data: { server: 'podcast102', ref: 'upload-id', ext: '.mp3', error: 0 } });
    }
    if (url.endsWith('/private/audios')) {
      const body = JSON.parse(options.body);
      assert.equal(body.image, testItem().image);
      assert.equal(body.scheduleDate, '2026-11-07 08:00:00');
      assert.equal(body.uploadReference, 'upload-id');
      return response({ id: 'created-audio' });
    }
    throw new Error(`URL inesperada: ${url}`);
  };
  const uploadImpl = async (url, file) => {
    calls.push({ url, file, method: 'PUT' });
    assert.equal(url, 'https://s3.example/upload');
    assert.equal(fs.statSync(file.path).size, file.size);
  };
  const stages = [];

  const result = await publishFile({
    file: { path: filePath, name: 'BASICO 41.mp3', mimeType: 'audio/mpeg' },
    item: testItem(),
    session: { jwt: 'ephemeral', apiBaseUrl: 'https://api.example/v1', podcastBaseUrl: 'https://files.example' },
    fetchImpl,
    uploadImpl,
    onStage: (stage) => stages.push(stage),
  });

  assert.deepEqual(stages, ['presign', 'put', 'register', 'create']);
  assert.deepEqual(calls.map((call) => call.method || call.options.method), ['POST', 'PUT', 'POST', 'POST']);
  assert.equal(result.objectKey, 'key');
});

test('un error de una publicación no detiene las otras tres del mismo MP3', async () => {
  const filePath = path.join(os.tmpdir(), `vaughanator-failure-${process.pid}-${Date.now()}.mp3`);
  fs.writeFileSync(filePath, Buffer.from('mock-mp3'));
  try {
    let creates = 0;
    const fetchImpl = async (url) => {
      if (url.endsWith('/private/audios/upload/presigned-url')) return response({ data: { key: 'k', uploadUrl: 'https://s3.example/u', downloadUrl: 'https://s3.example/d' } });
      if (url.endsWith('/ffmpeg/uploadHTML5.php')) return response({ data: { server: 'server', reference: 'ref' } });
      creates += 1;
      return creates === 1 ? response({ error: 'fallo de creación' }, 500) : response({ id: 'ok' });
    };
    const items = PROGRAMS.map((program) => ({ ...testItem(), id: `copy-${program.id}`, programId: program.id, programName: program.name }));
    const results = await publishBatch({
      items,
      resolveFile: (item) => ({ path: filePath, name: item.name, mimeType: 'audio/mpeg' }),
      session: { jwt: 'ephemeral', apiBaseUrl: 'https://api.example/v1', podcastBaseUrl: 'https://files.example' },
      fetchImpl,
      uploadImpl: async () => {},
    });
    assert.deepEqual(results.map((result) => result.status), ['error', 'success', 'success', 'success']);
    assert.equal(creates, 4);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

test('publica el mismo MP3 en los cuatro programas con una subida completa por destino', async (t) => {
  const filePath = path.join(os.tmpdir(), `vaughanator-four-programs-${process.pid}-${Date.now()}.mp3`);
  fs.writeFileSync(filePath, Buffer.from('mock-mp3'));
  t.after(() => fs.rmSync(filePath, { force: true }));

  const sequence = [];
  const registeredPrograms = [];
  const createdPrograms = [];
  let presigns = 0;
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/private/audios/upload/presigned-url')) {
      sequence.push('presign');
      presigns += 1;
      return response({ data: { key: `key-${presigns}`, uploadUrl: `https://s3.example/upload-${presigns}`, downloadUrl: `https://s3.example/file-${presigns}.mp3` } });
    }
    if (url.endsWith('/ffmpeg/uploadHTML5.php')) {
      sequence.push('register');
      registeredPrograms.push(options.body.get('programId'));
      return response({ data: { uploadServer: 'podcast101', uploadReference: `upload-${registeredPrograms.length}` } });
    }
    if (url.endsWith('/private/audios')) {
      sequence.push('create');
      const body = JSON.parse(options.body);
      createdPrograms.push(body.programId);
      assert.equal(body.image, testItem().image);
      return response({ id: `created-${createdPrograms.length}` });
    }
    throw new Error(`URL inesperada: ${url}`);
  };
  const uploadImpl = async () => { sequence.push('put'); };
  const items = PROGRAMS.map((program) => ({ ...testItem(), id: `copy-${program.id}`, programId: program.id, programName: program.name }));

  const results = await publishBatch({
    items,
    resolveFile: (item) => ({ path: filePath, name: item.name, mimeType: 'audio/mpeg' }),
    session: { jwt: 'ephemeral', apiBaseUrl: 'https://api.example/v1', podcastBaseUrl: 'https://files.example' },
    fetchImpl,
    uploadImpl,
  });

  assert.deepEqual(results.map((result) => result.status), ['success', 'success', 'success', 'success']);
  assert.deepEqual(sequence, ['presign', 'put', 'register', 'create', 'presign', 'put', 'register', 'create', 'presign', 'put', 'register', 'create', 'presign', 'put', 'register', 'create']);
  assert.deepEqual(registeredPrograms, PROGRAMS.map((program) => program.id));
  assert.deepEqual(createdPrograms, PROGRAMS.map((program) => program.id));
});

test('putFile transmite el MP3 local con content-type al destino', async (t) => {
  const filePath = path.join(os.tmpdir(), `vaughanator-put-${process.pid}-${Date.now()}.mp3`);
  const bytes = Buffer.from('mock-mp3-content');
  fs.writeFileSync(filePath, bytes);
  let resolveRequest;
  const requestBody = new Promise((resolve) => { resolveRequest = resolve; });
  const serverReady = new Promise((resolve, reject) => {
    const server = http.createServer((request, responseOut) => {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        resolveRequest({
          type: request.headers['content-type'],
          contentLength: request.headers['content-length'],
          transferEncoding: request.headers['transfer-encoding'],
          data: Buffer.concat(chunks),
        });
        responseOut.writeHead(200);
        responseOut.end();
      });
      request.on('error', reject);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
  const target = await serverReady;
  try {
    const requestLogs = [];
    const signedUrl = `${target.url}/upload?X-Amz-Signature=top-secret-signature&X-Amz-Credential=private-credential`;
    await putFile(signedUrl, { path: filePath, name: 'BASICO 41.mp3', mimeType: 'audio/mpeg', size: bytes.length }, globalThis.fetch, (entry) => requestLogs.push(entry));
    const request = await requestBody;
    assert.equal(request.type, 'audio/mpeg');
    assert.equal(request.contentLength, String(bytes.length));
    assert.equal(request.transferEncoding, undefined);
    assert.deepEqual(request.data, bytes);
    assert.match(requestLogs[0].url, /X-Amz-Signature=\[REDACTADO\]/);
    assert.doesNotMatch(JSON.stringify(requestLogs), /top-secret-signature|private-credential/);
    assert.equal(requestLogs[0].headers['content-length'], String(bytes.length));
    assert.equal(requestLogs.at(-1).status, 200);
  } finally {
    target.server.close();
    fs.rmSync(filePath, { force: true });
  }
});
