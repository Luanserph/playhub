function cleanTextTags(text: string): string {
  return text
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/\\N|\\n/g, '\n')
    .replace(/\\h/g, ' ')
    .replace(/<\/?(?:font|span|div|script|style|a|img)[^>]*>/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

function assTimeToVtt(raw: string): string | null {
  const match = raw.trim().match(/^(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/);
  if (!match) return null;
  const h = String(Number(match[1])).padStart(2, '0');
  const m = String(Number(match[2])).padStart(2, '0');
  const s = String(Number(match[3])).padStart(2, '0');
  const frac = match[4] ?? '00';
  const ms = frac.length === 2 ? `${frac}0` : frac.padEnd(3, '0').slice(0, 3);
  return `${h}:${m}:${s}.${ms}`;
}

function assToVtt(raw: string): string {
  const lines = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let startIdx = 1;
  let endIdx = 2;
  let textIdx = 9;
  let inEvents = false;
  const cues: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[events\]/i.test(trimmed)) {
      inEvents = true;
      continue;
    }
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      inEvents = false;
      continue;
    }
    if (!inEvents) continue;

    if (/^format\s*:/i.test(trimmed)) {
      const cols = trimmed
        .replace(/^format\s*:/i, '')
        .split(',')
        .map((c) => c.trim().toLowerCase());
      const sI = cols.indexOf('start');
      const eI = cols.indexOf('end');
      const tI = cols.indexOf('text');
      if (sI >= 0) startIdx = sI;
      if (eI >= 0) endIdx = eI;
      if (tI >= 0) textIdx = tI;
      continue;
    }

    if (/^dialogue\s*:/i.test(trimmed)) {
      const payload = trimmed.replace(/^dialogue\s*:/i, '').trim();
      const parts = payload.split(',');
      if (parts.length <= textIdx) continue;
      const start = assTimeToVtt(parts[startIdx] ?? '');
      const end = assTimeToVtt(parts[endIdx] ?? '');
      if (!start || !end) continue;
      const rawText = parts.slice(textIdx).join(',');
      const cleaned = cleanTextTags(rawText);
      if (!cleaned) continue;
      cues.push(`${start} --> ${end}\n${cleaned}`);
    }
  }

  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

function srtToVtt(raw: string): string {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const withoutHeader = normalized.replace(/^WEBVTT[^\n]*\n+/i, '');
  const blocks = withoutHeader.split(/\n{2,}/);
  const cues: string[] = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx === -1) continue;

    const timing = (lines[timingIdx] ?? '').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    const text = cleanTextTags(lines.slice(timingIdx + 1).join('\n'));
    if (!text) continue;

    cues.push(`${timing}\n${text}`);
  }

  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

export function convertSubtitleToVtt(raw: string, fileName = ''): string {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.ass') || lowerName.endsWith('.ssa') || /^\[script info\]/im.test(raw)) {
    return assToVtt(raw);
  }
  return srtToVtt(raw);
}

export function convertVttToSrt(vtt: string): string {
  const normalized = vtt
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^WEBVTT[^\n]*\n+/i, '')
    .trim();

  if (!normalized) return '';
  const blocks = normalized.split(/\n{2,}/);
  const srtBlocks: string[] = [];
  let index = 1;

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0);
    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx === -1) continue;

    const timing = (lines[timingIdx] ?? '')
      .split(/\s+/)
      .slice(0, 3)
      .join(' ')
      .replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2');
    const text = lines.slice(timingIdx + 1).join('\n').trim();
    if (!text) continue;

    srtBlocks.push(`${index}\n${timing}\n${text}`);
    index++;
  }

  return `${srtBlocks.join('\n\n')}\n`;
}

export function buildExternalM3u(streamUrl: string, title: string): string {
  const cleanTitle = title.replace(/[\r\n]+/g, ' ').trim() || 'PlayHub Stream';
  return `#EXTM3U\n#EXTINF:-1,${cleanTitle}\n${streamUrl}\n`;
}

export function triggerTextDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
