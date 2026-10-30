

export function relativeDate(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 'niedawno';
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

export function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

export function formatBytes(value: number) {
  if (value >= 1_048_576) return `${(value / 1_048_576).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}
