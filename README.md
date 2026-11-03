# Vaughanator

Aplicación local de Electron para preparar y programar audios en iVoox.

## Puesta en marcha

Requiere Node.js 22.12 o superior. Desde la carpeta del proyecto:

```powershell
npm install
npm start
```

Para ejecutar las pruebas de reglas y flujo API:

```powershell
npm test
```

## Builds portables

Los artefactos se guardan en `dist/`:

```powershell
npm run dist:win
npm run dist:linux
npm run dist:mac
```

- Windows: `.exe` portable x64, no requiere instalador. La build exige una firma Authenticode válida y verifica tanto el portable como el ejecutable desempaquetado.
- Linux: `AppImage` x64.
- macOS: `.dmg` (abrir y arrastrar la app a Aplicaciones).

`dist:linux` verifica que se ejecute en Linux y falla con un mensaje claro en otros sistemas; AppImage necesita herramientas nativas como `mksquashfs`. `dist:mac` debe ejecutarse en un Mac. El DMG es una imagen de disco para arrastrar la app a Aplicaciones, no un instalador con asistente. La firma y notarización de Apple aún no están configuradas, por lo que Gatekeeper puede mostrar una advertencia.

Para firmar Windows, configura `WIN_CSC_LINK` con la ruta de un certificado Authenticode `.pfx`/`.p12` y `WIN_CSC_KEY_PASSWORD` con su contraseña en el entorno que ejecuta `npm run dist:win`. Mantén las credenciales fuera del repositorio.

## Uso

1. Selecciona el entorno, abre iVoox con el enlace “Haz login con tu @ivoox”, entra al entorno de ZP correspondiente y copia el token con el comando indicado. Pega el token y pulsa “Iniciar sesión”. `Pre` está seleccionado inicialmente; la app consulta `/private/users/me` y solo admite el usuario con ID `39386`.
2. Elige el sábado futuro de inicio. Cada MP3 se publicará en los cuatro programas de referencia.
3. Arrastra los MP3 o selecciónalos. Deben llamarse `BASICO ##.mp3`, `MEDIO ##.mp3` o `AVANZADO ##.mp3`.
4. Revisa la preview y confirma el lote. Los episodios deben ser correlativos; se permiten niveles parciales.

La app calcula la publicación de cada episodio a partir de las 08:00 hora local, separando 15 segundos cada audio de ese episodio. Las cuatro copias de cada audio comparten inicialmente fecha y hora, que puede editarse por publicación. Los números de episodio avanzan una semana cada uno.

Cada MP3 genera cuatro filas en la preview, una por programa. Título y descripción base siguen las hojas de referencia; la descripción personaliza el texto de apoyo para cada programa. Al publicar, cada copia ejecuta `presign → PUT → uploadHTML5.php → CreatePodcasterAudio → /private/lists/add-audio`.

El desplegable “En paralelo” permite ejecutar 1, 2, 4, 8 o todas las publicaciones pendientes simultáneamente. Un fallo queda asociado a su fila y no detiene las demás.

El JWT no se guarda en disco ni en almacenamiento del navegador. Se mantiene solo en memoria del proceso principal hasta cerrar la app.

El panel “Registro técnico de requests” muestra requests y respuestas durante la sesión y permite copiarlos o limpiarlos. No se escribe a disco; el JWT y los valores de firma de URLs S3 se ocultan.

Los entornos fijan las URLs de API y podcast: Producción usa `https://core.ivoox.com/v1` y `https://files.ivoox.com`; Pre usa `https://core.ivoox.net/v1` y `https://files.ivoox.net`; Local usa `https://core.ivoox.loc:1443/v1` y `https://files.ivoox.net`. Cambiar de entorno después de conectar cierra la sesión y requiere introducir el JWT otra vez.

## Flujo API

Por publicación: `POST /private/audios/upload/presigned-url` → PUT del MP3 a `uploadUrl` → POST a `/ffmpeg/uploadHTML5.php` con la URL de descarga, tamaño, MIME y programa → `POST /private/audios`. La secuencia se repite para cada uno de los cuatro programas.

Los campos de metadatos se integran a partir de los Excel de referencia. La app no lee archivos Excel. Las portadas usan las URLs estáticas de iVoox configuradas por nivel.
