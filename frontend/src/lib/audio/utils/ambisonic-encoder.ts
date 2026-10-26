/**
 * AmbisonicMonoEncoder
 *
 * Mono input → (order+1)² discrete ACN channels, one GainNode per channel, with
 * gains = real spherical harmonics in SN3D (AmbiX) for the source direction.
 * Replaces JSAmbisonics `monoEncoder` + `applySn3dToEncoder()`: it writes SN3D
 * directly, which is what every bus downstream (OmnitoneDecoder, IR
 * convolution, the multichannel send) expects.
 *
 * Conventions (identical to JSAmbisonics / spherical-harmonic-transform, pinned
 * by ambisonic-encoder.test.ts): azimuth counter-clockwise from +X (front) toward
 * +Y (left), elevation up from the horizontal plane, both in radians; ACN index
 * n² + n + m, sin(|m|·az) for m < 0, cos(m·az) for m > 0; no Condon–Shortley phase.
 */

/** Associated Legendre P_n^m(x) for 0 ≤ m ≤ n ≤ order, without Condon–Shortley phase. */
function legendreTable(order: number, x: number): number[][] {
  const p: number[][] = Array.from({ length: order + 1 }, () => new Array<number>(order + 1).fill(0));
  const s = Math.sqrt(Math.max(0, 1 - x * x));
  p[0][0] = 1;
  for (let m = 1; m <= order; m++) p[m][m] = (2 * m - 1) * s * p[m - 1][m - 1];
  for (let m = 0; m < order; m++) p[m + 1][m] = (2 * m + 1) * x * p[m][m];
  for (let m = 0; m <= order; m++) {
    for (let n = m + 2; n <= order; n++) {
      p[n][m] = ((2 * n - 1) * x * p[n - 1][m] - (n + m - 1) * p[n - 2][m]) / (n - m);
    }
  }
  return p;
}

function factorial(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

/** SN3D gains (ACN order) for a plane wave from (azimuth, elevation), in radians. */
export function computeSn3dGains(order: number, azimuth: number, elevation: number): number[] {
  const p = legendreTable(order, Math.sin(elevation));
  const gains = new Array<number>((order + 1) ** 2);
  for (let n = 0; n <= order; n++) {
    gains[n * n + n] = p[n][0];
    for (let m = 1; m <= n; m++) {
      const norm = Math.sqrt((2 * factorial(n - m)) / factorial(n + m)) * p[n][m];
      gains[n * n + n - m] = norm * Math.sin(m * azimuth);
      gains[n * n + n + m] = norm * Math.cos(m * azimuth);
    }
  }
  return gains;
}

export class AmbisonicMonoEncoder {
  readonly in: GainNode;
  readonly out: ChannelMergerNode;
  readonly gainNodes: GainNode[];
  private readonly order: number;

  constructor(ctx: BaseAudioContext, order: number) {
    this.order = order;
    const nCh = (order + 1) ** 2;
    this.in = ctx.createGain();
    this.in.channelCountMode = 'explicit';
    this.in.channelCount = 1;
    this.out = ctx.createChannelMerger(nCh);
    this.gainNodes = Array.from({ length: nCh }, (_, ch) => {
      const node = ctx.createGain();
      node.channelCountMode = 'explicit';
      node.channelCount = 1;
      this.in.connect(node);
      node.connect(this.out, 0, ch);
      return node;
    });
    this.setDirection(0, 0);
  }

  /** Point the encoding at (azimuth, elevation), in radians (see file header). */
  setDirection(azimuth: number, elevation: number): void {
    const gains = computeSn3dGains(this.order, azimuth, elevation);
    this.gainNodes.forEach((node, ch) => {
      node.gain.value = gains[ch];
    });
  }

  dispose(): void {
    try {
      this.in.disconnect();
      this.out.disconnect();
      this.gainNodes.forEach((node) => node.disconnect());
    } catch {
      // Already disconnected
    }
  }
}
