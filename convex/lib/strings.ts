export function cleanSingleLine(value: string, maxLength: number) {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export function capText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n\n[Content truncated]`;
}
