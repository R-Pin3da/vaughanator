const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_ENVIRONMENT_ID,
  ENVIRONMENTS,
  makePreviewItem,
  makePublicationItems,
  parseAudioFilename,
  toScheduleLocal,
  validateBatch,
  validateSchedule,
} = require('../src/domain.js');

test('define los tres entornos y deja Pre como valor inicial', () => {
  assert.equal(DEFAULT_ENVIRONMENT_ID, 'pre');
  assert.deepEqual(ENVIRONMENTS, [
    { id: 'production', name: 'Producción', apiBaseUrl: 'https://core.ivoox.com/v1', podcastBaseUrl: 'https://files.ivoox.com' },
    { id: 'pre', name: 'Pre', apiBaseUrl: 'https://core.ivoox.net/v1', podcastBaseUrl: 'https://files.ivoox.net' },
    { id: 'local', name: 'Local', apiBaseUrl: 'https://core.ivoox.loc:1443/v1', podcastBaseUrl: 'https://files.ivoox.net' },
  ]);
});

test('reconoce los tres niveles y acepta prefijos en minúsculas', () => {
  assert.equal(parseAudioFilename('basico 61.mp3').level, 'BASICO');
  assert.equal(parseAudioFilename('MEDIO 61.MP3').episode, 61);
  assert.equal(parseAudioFilename('AVANZADO 61.mp3').metadata.label, 'Avanzado');
});

test('rechaza nombres, extensiones y números inválidos', () => {
  for (const name of ['BÁSICO 1.mp3', 'BASICO.mp3', 'MEDIO 0.mp3', 'NIVEL 1.mp3', 'AVANZADO 2.wav']) {
    assert.equal(parseAudioFilename(name).ok, false, name);
  }
});

test('valida duplicados por nivel y episodio, y exige números correlativos', () => {
  const duplicate = validateBatch([{ name: 'BASICO 41.mp3' }, { name: 'BASICO 41.mp3' }]);
  assert.ok(duplicate.errors.some((error) => error.message.includes('más de un archivo')));

  const gap = validateBatch([{ name: 'BASICO 41.mp3' }, { name: 'AVANZADO 43.mp3' }]);
  assert.deepEqual(gap.missingEpisodes, [42]);
  assert.ok(gap.errors.some((error) => error.message.includes('correlativos')));
});

test('acepta niveles parciales y ordena por episodio y nivel', () => {
  const result = validateBatch([
    { name: 'AVANZADO 42.mp3' },
    { name: 'MEDIO 41.mp3' },
    { name: 'BASICO 41.mp3' },
  ]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.files.map((file) => file.name), ['BASICO 41.mp3', 'MEDIO 41.mp3', 'AVANZADO 42.mp3']);
});

test('calcula franjas locales y semanas correlativas', () => {
  assert.equal(toScheduleLocal('2026-11-07', 'BASICO', 41, 41), '2026-11-07 08:00:00');
  assert.equal(toScheduleLocal('2026-11-07', 'MEDIO', 41, 41), '2026-11-07 08:00:15');
  assert.equal(toScheduleLocal('2026-11-07', 'AVANZADO', 41, 41), '2026-11-07 08:00:30');
  assert.equal(toScheduleLocal('2026-11-07', 'BASICO', 42, 41), '2026-11-14 08:00:00');
  assert.equal(toScheduleLocal('2026-11-07', 'AVANZADO', 41, 41, 1), '2026-11-07 08:00:15');
});

test('la preview incorpora perfil, texto, imagen y fecha del programa elegido', () => {
  const parsed = parseAudioFilename('BASICO 41.mp3');
  const item = makePreviewItem({ name: 'BASICO 41.mp3', ...parsed }, '17145', '2026-11-07', 41);
  assert.equal(item.programName, 'Drive Time');
  assert.match(item.title, /Episodio 41 Nivel Básico/);
  assert.match(item.description, /Apoya a Drive Time/);
  assert.equal(item.image, 'https://static-1.ivoox.com/audios/0/d/9/d/0d9dbd87327e914b72f54b8361123cf4_XXL.jpg');
  assert.equal(item.type, 'FANS');
  assert.equal(item.scheduleDate, '2026-11-07 08:00:00');
});

test('genera cuatro publicaciones por MP3 con horario común y texto de apoyo personalizado', () => {
  const parsed = parseAudioFilename('BASICO 41.mp3');
  const publications = makePublicationItems({ name: 'BASICO 41.mp3', ...parsed }, '2026-11-07', 41, 0);
  const nextLevel = parseAudioFilename('MEDIO 41.mp3');
  const nextPublications = makePublicationItems({ name: 'MEDIO 41.mp3', ...nextLevel }, '2026-11-07', 41, 1);
  assert.equal(publications.length, 4);
  assert.deepEqual(publications.map((item) => item.programId), ['17145', '2295625', '80769', '2830059']);
  assert.deepEqual(new Set(publications.map((item) => item.scheduleDate)), new Set(['2026-11-07 08:00:00']));
  assert.deepEqual(new Set(nextPublications.map((item) => item.scheduleDate)), new Set(['2026-11-07 08:00:15']));
  publications.forEach((item) => assert.match(item.description, new RegExp(`Apoya a ${item.programName}`)));
  assert.equal(new Set(publications.map((item) => item.title)).size, 1);
});

test('rechaza sábados pasados y permite los futuros', () => {
  const past = validateSchedule([{ scheduleDate: '2026-10-31 08:00:00' }], new Date(2026, 10, 2, 12));
  const future = validateSchedule([{ scheduleDate: '2026-11-07 08:00:00' }], new Date(2026, 10, 2, 12));
  assert.equal(past.ok, false);
  assert.equal(future.ok, true);
});
