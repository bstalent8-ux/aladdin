/** Characters, counted like the database's `char_length`: one per Unicode character (an Arabic letter or an emoji is ONE), a line break once. Not bytes, not words. */
export function countChars(value: string): number {
  return Array.from(value.replace(/\r\n?/g, "\n")).length;
}
