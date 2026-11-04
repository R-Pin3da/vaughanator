# Vaughanator

Aplicación web estática para preparar y programar audios Vaughan en iVoox.

## Desarrollo

Requiere Node.js 22.12 o superior. Instala las dependencias y arranca el servidor de desarrollo de Vite:

```bash
npm install
npm run dev
```

Vite sirve la aplicación desde `src/vaughanator.html` y actualiza el navegador al editar los archivos. Abre `/vaughanator.html` en desarrollo y producción. Para generar el sitio de producción:

```bash
npm run build
```

El resultado listo para desplegar está en `web-dist/`: incluye `vaughanator.html` y sus recursos. Puedes revisar el build localmente con:

```bash
npm run preview
```

Publica el contenido de `web-dist/` en un hosting estático HTTPS. La versión desplegada solo requiere HTML, JavaScript, CSS y el icono SVG; no necesita Node.js ni un backend propio.

Para comprobar las reglas y el cliente web:

```bash
npm test
```

## Requisitos de conexión

El navegador llama directamente a las APIs de iVoox y sube los MP3 a la URL presignada. API y podcast deben permitir CORS desde el dominio publicado para `core.ivoox.*` y `files.ivoox.*`. El host S3 de las URLs presignadas también debe aceptar CORS para `PUT` y el header `Content-Type`.

El JWT y los MP3 permanecen en la memoria de la pestaña y no se guardan en almacenamiento local. Al cerrar o recargar la pestaña se elimina la sesión.

## Uso

1. Selecciona el entorno, inicia sesión en iVoox con el enlace indicado, entra al entorno de ZP correspondiente y copia el token con el comando mostrado. Pega el token y pulsa «Iniciar sesión». `Pre` está seleccionado inicialmente; la aplicación valida `/private/users/me` y solo admite el usuario con ID `39386`.
2. Elige el sábado futuro de inicio. Cada MP3 se publicará en los cuatro programas configurados.
3. Arrastra o selecciona los MP3. Deben llamarse `BASICO ##.mp3`, `MEDIO ##.mp3` o `AVANZADO ##.mp3`.
4. Revisa la vista previa y confirma el lote. Los episodios deben ser correlativos; se permiten niveles parciales.

La aplicación programa cada episodio desde las 08:00 hora local y separa 15 segundos cada audio de ese episodio. Las cuatro copias de cada audio comparten inicialmente el horario, que puede editarse en la vista previa. Los números de episodio avanzan una semana cada uno.

Cada MP3 genera cuatro filas, una por programa. Al publicar, cada copia ejecuta `presign → PUT → uploadHTML5.php → CreatePodcasterAudio → /private/lists/add-audio`. El desplegable «En paralelo» permite ejecutar 1, 2 o 4 publicaciones simultáneamente. Un fallo queda asociado a su fila y no detiene las demás.

El panel «Registro técnico de requests» muestra las solicitudes y respuestas de la sesión y permite copiarlas o limpiarlas. El JWT y los valores de firma de las URLs S3 se ocultan.

Los entornos fijan las URLs de API y podcast: Producción usa `https://core.ivoox.com/v1` y `https://files.ivoox.com`; Pre usa `https://core.ivoox.net/v1` y `https://files.ivoox.net`; Local usa `https://core.ivoox.loc:1443/v1` y `https://files.ivoox.net`. Cambiar de entorno después de conectar cierra la sesión y requiere introducir el JWT otra vez.

La aplicación incorpora los metadatos de publicación y las portadas de referencia. No lee los Excel de origen.
