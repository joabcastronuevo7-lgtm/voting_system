/** First letters of the first and last word, shown in the round badge beside a name. */
export const initials = (name: string) => {
  const words = name.trim().split(/\s+/);
  return [words[0], words.length > 1 ? words.at(-1)! : ""]
    .map((word) => [...word][0] ?? "")
    .join("")
    .toLocaleUpperCase();
};
