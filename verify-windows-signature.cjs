const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const packageConfig = require('./package.json');
const productName = packageConfig.build.productName || packageConfig.name;
const version = packageConfig.version;

const files = [
  path.resolve('dist', 'win-unpacked', `${productName}.exe`),
  path.resolve('dist', `${productName}-${version}-win-x64.exe`),
];

for (const file of files) {
  if (!existsSync(file)) {
    console.error(`No existe el artefacto que se debe verificar: ${file}`);
    process.exitCode = 1;
    continue;
  }

  const escapedPath = file.replaceAll("'", "''");
  const script = [
    `$signature = Get-AuthenticodeSignature -LiteralPath '${escapedPath}'`,
    `Write-Output ('{0}: {1} ({2})' -f '${escapedPath}', $signature.Status, $signature.SignatureType)`,
    "if ($signature.Status -ne 'Valid' -or $signature.SignatureType -eq 'None') { exit 1 }",
  ].join('; ');

  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'inherit',
    });
  } catch {
    console.error(`La firma Authenticode no es válida para: ${file}`);
    process.exitCode = 1;
  }
}
