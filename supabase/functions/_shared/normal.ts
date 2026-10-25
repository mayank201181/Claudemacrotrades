// The normal distribution, shared by the convexity marks (convexity.ts) and the Trend Monitor
// (trend.ts). Kept in its own file so an edge function that needs only these is bundled small.

// Cumulative normal, double precision (Hart 1968 as given by West 2005; |error| < 1e-14).
export function normCdf(x: number): number {
  const z = Math.abs(x);
  let c: number;
  if (z > 37) c = 0;
  else {
    const e = Math.exp((-z * z) / 2);
    if (z < 7.07106781186547) {
      let n = 3.52624965998911e-2 * z + 0.700383064443688;
      n = n * z + 6.37396220353165; n = n * z + 33.912866078383; n = n * z + 112.079291497871;
      n = n * z + 221.213596169931; n = n * z + 220.206867912376;
      let d = 8.83883476483184e-2 * z + 1.75566716318264;
      d = d * z + 16.064177579207; d = d * z + 86.7807322029461; d = d * z + 296.564248779674;
      d = d * z + 637.333633378831; d = d * z + 793.826512519948; d = d * z + 440.413735824752;
      c = (e * n) / d;
    } else c = e / tailB(z) / 2.506628274631;
  }
  return x > 0 ? 1 - c : c;
}
// The continued fraction of the far tail (z ≥ 7.07): Φ(−z) = φ(z)·√(2π) / (b·√(2π)) = e^(−z²/2) / (b·√(2π)).
export function tailB(z: number): number {
  let b = z + 0.65;
  b = z + 4 / b; b = z + 3 / b; b = z + 2 / b; b = z + 1 / b;
  return b;
}
export const normPdf = (x: number) => Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);
