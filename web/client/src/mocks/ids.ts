/** 模拟 ID 生成（正式环境由后端雪花 ID 生成） */
let seq = 1000;
export const nextId = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

/** 确定性伪随机数，保证每次打开原型的模拟数据一致 */
export function seeded(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const minutesAgo = (m: number, now = Date.now()): string => new Date(now - m * 60_000).toISOString();
export const hoursFromNow = (h: number, now = Date.now()): string => new Date(now + h * 3_600_000).toISOString();
