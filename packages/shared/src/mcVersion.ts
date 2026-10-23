/** Numeric comparison of dotted Minecraft versions ("1.20.1" < "1.21" < "26.1"); non-numeric versions sort as equal. */
export function compareMcVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (Number.isNaN(diff)) return 0;
    if (diff !== 0) return diff;
  }
  return 0;
}
