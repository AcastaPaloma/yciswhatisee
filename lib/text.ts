/** Removes expressive audio tags like [warmly] or [laughs] so they're never shown or read aloud. */
export const stripTags = (s: string) => s.replace(/\[[^\]\n]{1,40}\]/g, "").replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
