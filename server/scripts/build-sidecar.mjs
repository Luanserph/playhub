import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverDir = path.resolve(__dirname, '..');
const distDir = path.join(serverDir, 'dist');
const binariesDir = path.resolve(serverDir, '../src-tauri/binaries');
const outputExe = path.join(binariesDir, 'playhub-server-x86_64-pc-windows-msvc.exe');
const isWin = process.platform === 'win32';

fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(binariesDir, { recursive: true });

console.log('[build-sidecar] 1/5 Empacotando backend com esbuild...');
execFileSync(
  isWin ? 'npx.cmd' : 'npx',
  [
    'esbuild',
    'src/index.ts',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node22',
    '--external:utf-8-validate',
    '--external:bufferutil',
    '--outfile=dist/bundle.cjs',
  ],
  { cwd: serverDir, stdio: 'inherit', shell: isWin }
);

console.log('[build-sidecar] 2/5 Gerando blob Node.js SEA...');
execFileSync(process.execPath, ['--experimental-sea-config', 'sea-config.json'], {
  cwd: serverDir,
  stdio: 'inherit',
});

console.log(`[build-sidecar] 3/5 Copiando runtime Node (${process.execPath}) para sidecar...`);
fs.copyFileSync(process.execPath, outputExe);

console.log('[build-sidecar] 4/5 Removendo assinatura original do executável (se signtool estiver disponível)...');
try {
  execFileSync('signtool', ['remove', '/s', outputExe], {
    cwd: serverDir,
    stdio: 'pipe',
    shell: isWin,
  });
  console.log('[build-sidecar] Assinatura original removida via signtool.');
} catch {
  console.log('[build-sidecar] signtool não encontrado ou não necessário — prosseguindo.');
}

console.log('[build-sidecar] 5/5 Injetando NODE_SEA_BLOB com postject...');
execFileSync(
  isWin ? 'npx.cmd' : 'npx',
  [
    'postject',
    outputExe,
    'NODE_SEA_BLOB',
    path.join(distDir, 'sea-prep.blob'),
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    '--overwrite',
  ],
  { cwd: serverDir, stdio: 'inherit', shell: isWin }
);

console.log(`[build-sidecar] Sidecar gerado com sucesso em: ${outputExe}`);
