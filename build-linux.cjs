const { spawnSync } = require('node:child_process');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    console.error(`No se pudo iniciar ${command}: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

if (process.platform === 'linux') {
  run(process.execPath, [require.resolve('electron-builder/cli.js'), '--linux', 'AppImage', '--x64']);
}

if (process.platform !== 'win32') {
  console.error('El target AppImage se debe compilar en Linux o desde Windows con Docker Desktop.');
  process.exit(1);
}

const dockerCheck = spawnSync('docker', ['info', '--format', '{{.OSType}}'], { encoding: 'utf8' });
if (dockerCheck.error || dockerCheck.status !== 0 || dockerCheck.stdout.trim() !== 'linux') {
  console.error('No se puede compilar AppImage desde Windows: Docker Desktop no está disponible. Usa Linux o inicia Docker Desktop.');
  process.exit(1);
}

const projectDirectory = process.cwd().replaceAll('\\', '/');
const dockerArgs = [
  'run', '--rm',
  '--mount', `type=bind,source=${projectDirectory},target=/project`,
  '--mount', 'type=volume,source=vaughanator-linux-node-modules,target=/project/node_modules',
  '--workdir', '/project',
  'electronuserland/builder:22',
  'sh', '-lc',
  'npm ci --legacy-peer-deps && node node_modules/electron-builder/cli.js --linux AppImage --x64',
];
run('docker', dockerArgs);
