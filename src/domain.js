const LEVELS = Object.freeze({
  BASICO: {
    key: 'basico',
    label: 'Básico',
    order: 0,
    image: 'https://static-1.ivoox.com/audios/0/d/9/d/0d9dbd87327e914b72f54b8361123cf4_XXL.jpg',
    listId: '11343355',
    tags: ['Aprender inglés', 'Inglés básico', 'Vaughan', 'Curso inglés'],
    titleLevel: 'Básico',
    description:
      'Vaughan Inglés 4.0 – Nivel Básico te ofrece 195 clases esenciales para empezar desde cero y construir una base sólida en inglés. Con el método Vaughan, aprenderás paso a paso la gramática más importante, vocabulario práctico y una pronunciación clara.\n\nCada episodio es una clase dinámica y sencilla, diseñada para que entiendas, repitas y practiques sin miedo. Perfecto si quieres iniciarte en el inglés de la forma más completa y efectiva.\n\nNuevos episodios cada sábado. Apoya a {program} o suscríbete a iVoox Plus para acceder a Vaughan Inglés 4.0 y a un catálogo de más de 90.000 episodios exclusivos y audiolibros desde https://www.ivoox.com/_10_promotion_1.html?promotion=72',
  },
  MEDIO: {
    key: 'medio',
    label: 'Medio',
    order: 1,
    image: 'https://static-1.ivoox.com/audios/1/5/f/4/15f45da963b303ae31da32d116964aea_XXL.jpg',
    listId: '11343356',
    tags: ['Aprender inglés', 'Inglés intermedio', 'Vaughan', 'Curso inglés'],
    titleLevel: 'Intermedio',
    description:
      'Vaughan Inglés 4.0 – Nivel Intermedio incluye 195 episodios pensados para quienes ya dominan lo básico y quieren dar un salto más en su inglés. Con el método Vaughan, consolidarás la gramática fundamental, ampliarás tu vocabulario y mejorarás tu fluidez y comprensión.\n\nCada lección es práctica, dinámica y enfocada en ayudarte a comunicarte con seguridad en situaciones reales.\n\nNuevos episodios cada sábado. Apoya a {program} o suscríbete a iVoox Plus para acceder a Vaughan Inglés 4.0 y a un catálogo de más de 90.000 episodios exclusivos y audiolibros desde https://www.ivoox.com/_10_promotion_1.html?promotion=72',
  },
  AVANZADO: {
    key: 'avanzado',
    label: 'Avanzado',
    order: 2,
    image: 'https://static-1.ivoox.com/audios/e/a/b/0/eab0475559e96a7c19af7001fde46563_XXL.jpg',
    listId: '11343358',
    tags: ['Aprender inglés', 'Inglés avanzado', 'Vaughan', 'Curso inglés'],
    titleLevel: 'Avanzado',
    description:
      'Vaughan Inglés 4.0 – Nivel Avanzado pone a tu disposición 195 episodios diseñados para perfeccionar tu inglés y llevarlo al máximo nivel. Con el método Vaughan, pulirás la gramática más compleja, enriquecerás tu vocabulario con matices y dominarás la pronunciación y la fluidez en contextos exigentes.\n\nCada clase está enfocada en que pienses y hables como un auténtico angloparlante, afinando tus habilidades para desenvolverte con confianza en el trabajo, en los estudios o en cualquier situación internacional.\n\nNuevos episodios cada sábado. Apoya a {program} o suscríbete a iVoox Plus para acceder a Vaughan Inglés 4.0 y a un catálogo de más de 90.000 episodios exclusivos y audiolibros desde https://www.ivoox.com/_10_promotion_1.html?promotion=72',
  },
});

const PROGRAMS = Object.freeze([
  { id: '17145', name: 'Drive Time' },
  { id: '2295625', name: 'Inglés con Ruby' },
  { id: '80769', name: 'Richard Vaughan Live' },
  { id: '2830059', name: 'Vaughan Inglés 4.0 Podcast' },
]);

const ENVIRONMENTS = Object.freeze([
  { id: 'production', name: 'Producción', apiBaseUrl: 'https://core.ivoox.com/v1', podcastBaseUrl: 'https://files.ivoox.com' },
  { id: 'pre', name: 'Pre', apiBaseUrl: 'https://core.ivoox.net/v1', podcastBaseUrl: 'https://files.ivoox.net' },
  { id: 'local', name: 'Local', apiBaseUrl: 'https://core.ivoox.loc:1443/v1', podcastBaseUrl: 'https://files.ivoox.net' },
]);
const DEFAULT_ENVIRONMENT_ID = 'pre';

const LEVEL_ORDER = Object.freeze(['BASICO', 'MEDIO', 'AVANZADO']);
const START_HOUR = 8;

function parseAudioFilename(filename) {
  const match = /^\s*(BASICO|MEDIO|AVANZADO)\s+(\d+)\.mp3\s*$/i.exec(String(filename || ''));
  if (!match) {
    return { ok: false, error: 'Nombre inválido. Usa BASICO ##.mp3, MEDIO ##.mp3 o AVANZADO ##.mp3.' };
  }

  const level = match[1].toUpperCase();
  const episode = Number(match[2]);
  if (!Number.isSafeInteger(episode) || episode < 1) {
    return { ok: false, error: 'El número de episodio debe ser un entero positivo.' };
  }

  return { ok: true, level, episode, metadata: LEVELS[level] };
}

function validateBatch(files) {
  const parsed = [];
  const errors = [];
  const seen = new Set();

  for (const file of files) {
    const result = parseAudioFilename(file.name);
    if (!result.ok) {
      errors.push({ file: file.name, message: result.error });
      continue;
    }

    const key = `${result.level}:${result.episode}`;
    if (seen.has(key)) {
      errors.push({ file: file.name, message: `El lote contiene más de un archivo ${result.level} para el episodio ${result.episode}.` });
      continue;
    }
    seen.add(key);
    parsed.push({ ...file, ...result });
  }

  const episodes = [...new Set(parsed.map((item) => item.episode))].sort((a, b) => a - b);
  const missingEpisodes = [];
  if (episodes.length > 1) {
    for (let episode = episodes[0] + 1; episode < episodes[episodes.length - 1]; episode += 1) {
      if (!episodes.includes(episode)) missingEpisodes.push(episode);
    }
  }
  if (missingEpisodes.length) {
    errors.push({
      file: null,
      message: `Los episodios deben ser correlativos. Faltan: ${missingEpisodes.join(', ')}.`,
    });
  }

  parsed.sort((a, b) => a.episode - b.episode || a.metadata.order - b.metadata.order || a.name.localeCompare(b.name));
  return { files: parsed, errors, episodes, missingEpisodes };
}

function parseLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
  return date;
}

function isSaturdayDate(value) {
  const date = parseLocalDate(value);
  return Boolean(date && date.getDay() === 6);
}

function toScheduleLocal(dateString, level, episode, firstEpisode, slotIndex = LEVELS[level]?.order || 0) {
  const date = parseLocalDate(dateString);
  if (!date || date.getDay() !== 6) throw new Error('La fecha inicial debe ser un sábado válido.');
  if (!LEVELS[level]) throw new Error('Nivel de audio no reconocido.');
  if (!Number.isInteger(episode) || !Number.isInteger(firstEpisode) || episode < firstEpisode) throw new Error('Número de episodio no válido.');

  date.setDate(date.getDate() + (episode - firstEpisode) * 7);
  date.setHours(START_HOUR, 0, slotIndex * 15, 0);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-') + ` ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

function formatScheduleForDisplay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(value);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]} ${match[4]}`;
}

function makePreviewItem(file, program, startDate, firstEpisode, slotIndex) {
  const profile = typeof program === 'string' ? PROGRAMS.find((item) => item.id === program) : program;
  if (!profile) throw new Error('El programa de referencia no es válido.');
  const scheduleDate = toScheduleLocal(startDate, file.level, file.episode, firstEpisode, slotIndex);
  return {
    ...file,
    programId: profile.id,
    programName: profile.name,
    title: `Episodio ${file.episode} Nivel ${file.metadata.titleLevel} - Vaughan Inglés 4.0 Podcast`,
    description: file.metadata.description.replaceAll('{program}', profile.name),
    image: file.metadata.image,
    tags: [...file.metadata.tags],
    listId: file.metadata.listId,
    subcategoryId: '51',
    genderId: '12',
    languageId: '3',
    type: 'FANS',
    iTunesType: 'full',
    scheduleDate,
  };
}

function makePublicationItems(file, startDate, firstEpisode, slotIndex) {
  return PROGRAMS.map((program) => makePreviewItem(file, program, startDate, firstEpisode, slotIndex));
}

function validateSchedule(items, now = new Date()) {
  const pastItems = items.filter((item) => {
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(item.scheduleDate);
    if (!match) return true;
    const [, year, month, day, hour, minute, second] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
    if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)
      || date.getHours() !== Number(hour) || date.getMinutes() !== Number(minute) || date.getSeconds() !== Number(second)) return true;
    return date <= now;
  });
  return pastItems.length
    ? { ok: false, message: 'La fecha u hora de publicación de algún audio no es válida o ya pasó. Ajusta ese audio a una fecha y hora futuras.' }
    : { ok: true };
}

const api = {
  LEVELS,
  LEVEL_ORDER,
  ENVIRONMENTS,
  DEFAULT_ENVIRONMENT_ID,
  PROGRAMS,
  formatScheduleForDisplay,
  scheduleToInputValue: (value) => value.replace(' ', 'T'),
  scheduleFromInputValue: (value) => value ? `${value.replace('T', ' ')}${value.length === 16 ? ':00' : ''}` : '',
  isSaturdayDate,
  makePreviewItem,
  makePublicationItems,
  parseAudioFilename,
  parseLocalDate,
  toScheduleLocal,
  validateBatch,
  validateSchedule,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.vaughanatorDomain = api;
