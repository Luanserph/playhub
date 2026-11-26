import fs from 'node:fs';
import path from 'node:path';

export function getDataDir(): string {
  const fromEnv = process.env.PLAYHUB_DATA_DIR?.trim();
  const dir = fromEnv || path.resolve(__dirname, '../../data');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function resolveBinaryPath(name: 'ffmpeg' | 'ffprobe'): string {
  const envVar = name === 'ffmpeg' ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH;
  if (envVar && envVar.trim()) {
    return envVar.trim();
  }

  const execDir = path.dirname(process.execPath);
  const candidates = [
    path.join(execDir, `${name}.exe`),
    path.join(execDir, `${name}-x86_64-pc-windows-msvc.exe`),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignora erro de acesso
    }
  }

  return name;
}
