export function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function pluralize(count: number, word: string): string {
  return `${count} ${word}${count !== 1 ? 's' : ''}`;
}
