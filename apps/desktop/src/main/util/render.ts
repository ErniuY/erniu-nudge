/**
 * 把 {elapsed} 这类变量替换成实际值；未知变量原样保留，方便排查。
 *
 * 参数类型刻意用 object 而不是 Record<string, unknown>：TemplateVariables 是接口，
 * 没有索引签名，传进来会报「Index signature is missing」。
 */
export function renderTemplate(template: string, variables: object): string {
  const map = variables as Record<string, unknown>;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(map, key) ? String(map[key]) : match,
  );
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分钟`;
  return `${seconds} 秒`;
}
