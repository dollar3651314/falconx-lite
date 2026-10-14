/** 展示工具：截断地址和哈希、按语言取名称 */
export function shortHash(value: string | null | undefined, head = 6, tail = 4): string {
  if (!value) return '—';
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function localName(lang: string, zh: string, en: string): string {
  return lang.startsWith('zh') ? zh : en;
}

/** "2026-10-14 09:12:33" → "10-14 09:12" */
export function shortTime(value: string | null | undefined): string {
  if (!value) return '—';
  const m = /^\d{4}-(\d{2}-\d{2}) (\d{2}:\d{2})/.exec(value);
  return m ? `${m[1]} ${m[2]}` : value;
}
