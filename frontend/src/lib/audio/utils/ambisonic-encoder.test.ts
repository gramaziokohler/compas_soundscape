import { describe, it, expect } from 'vitest';
import { AmbisonicMonoEncoder, computeSn3dGains } from './ambisonic-encoder';

/**
 * Reference gains from the JSAmbisonics pipeline this encoder replaces:
 * `spherical-harmonic-transform` computeRealSH(3, …) (N3D) × 1/√(2n+1)
 * (applySn3dToEncoder), generated before the `ambisonics` package was removed.
 * [azimuth°, elevation°, 16 ACN/SN3D gains].
 */
const REFERENCE: [number, number, number[]][] = [
  [0, 0, [1, 0, 0, 1, 0, 0, -0.5, 0, 0.8660254038, 0, 0, 0, 0, -0.6123724357, 0, 0.790569415]],
  [90, 0, [1, 1, 0, 0, 0, 0, -0.5, 0, -0.8660254038, -0.790569415, 0, -0.6123724357, 0, 0, 0, 0]],
  [-90, 0, [1, -1, 0, 0, 0, 0, -0.5, 0, -0.8660254038, 0.790569415, 0, 0.6123724357, 0, 0, 0, 0]],
  [180, 0, [1, 0, 0, -1, 0, 0, -0.5, 0, 0.8660254038, 0, 0, 0, 0, 0.6123724357, 0, -0.790569415]],
  [45, 30, [1, 0.6123724357, 0.5, 0.6123724357, 0.6495190528, 0.5303300859, -0.125, 0.5303300859, 0, 0.3630921887, 0.7261843774, 0.09375, -0.4375, 0.09375, 0, -0.3630921887]],
  [-120, -45, [1, -0.6123724357, -0.7071067812, -0.3535533906, 0.375, 0.75, 0.25, 0.4330127019, -0.2165063509, 0, -0.5929270613, -0.5625, 0.1767766953, -0.3247595264, 0.3423265984, 0.2795084972]],
  [30, 60, [1, 0.25, 0.8660254038, 0.4330127019, 0.1875, 0.375, 0.625, 0.6495190528, 0.1082531755, 0.09882117688, 0.3630921887, 0.4210060495, 0.3247595264, 0.7292038681, 0.2096313729, 0]],
  [135, -15, [1, 0.6830127019, -0.2588190451, -0.6830127019, -0.8080127019, -0.3061862178, -0.3995190528, 0.3061862178, 0, 0.503797891, 0.4676268299, -0.2781682343, 0.3448845963, 0.2781682343, 0, 0.503797891]],
  [-60, 75, [1, -0.224143868, 0.9659258263, 0.1294095226, -0.05024047358, -0.375, 0.8995190528, 0.2165063509, -0.02900635095, 0, -0.1085131835, -0.5030648816, 0.8041639231, 0.2904446448, -0.06265011571, -0.01370656722]],
  [10, -80, [1, 0.03015368961, -0.984807753, 0.1710100717, 0.008931466556, -0.05143426598, 0.9547694656, -0.2916982175, 0.02453900269, 0.0020697634, -0.01966795643, 0.07107717053, -0.9105687847, 0.403098665, -0.05403726617, 0.003584935369]],
  [0, 90, [1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0]],
  [0, -90, [1, 0, -1, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 0]],
  [270, 20, [1, -0.9396926208, 0.3420201433, 0, 0, -0.5566703992, -0.3245333323, 0, -0.764719676, 0.655990361, 0, 0.2388723076, -0.4130083236, 0, -0.5848425357, 0]],
  [-170, 5, [1, -0.1729873939, 0.08715574275, -0.9810602622, 0.2939481751, -0.02611386122, -0.4886058148, -0.1480990664, 0.8076159737, -0.3907893243, 0.05728643268, 0.101909322, -0.1290784997, 0.5779564849, 0.1573931802, -0.6768669648]],
];

const DEG = Math.PI / 180;

describe('computeSn3dGains', () => {
  it('matches the JSAmbisonics monoEncoder + applySn3dToEncoder gains at order 3', () => {
    for (const [az, el, expected] of REFERENCE) {
      const gains = computeSn3dGains(3, az * DEG, el * DEG);
      expect(gains).toHaveLength(16);
      gains.forEach((g, acn) => expect(g, `az ${az} el ${el} acn ${acn}`).toBeCloseTo(expected[acn], 8));
    }
  });

  it('gives each lower order the leading channels of the order-3 gains', () => {
    for (const [az, el, expected] of REFERENCE) {
      for (const order of [1, 2]) {
        const gains = computeSn3dGains(order, az * DEG, el * DEG);
        expect(gains).toHaveLength((order + 1) ** 2);
        gains.forEach((g, acn) => expect(g).toBeCloseTo(expected[acn], 8));
      }
    }
  });
});

describe('AmbisonicMonoEncoder', () => {
  /** Minimal Web Audio stand-ins: nodes record their connections. */
  function fakeContext() {
    const node = () => {
      const n = {
        gain: { value: 1 },
        channelCount: 2,
        channelCountMode: 'max',
        links: [] as { to: unknown; input: number }[],
        connect: (to: unknown, _output = 0, input = 0) => { n.links.push({ to, input }); },
        disconnect: () => { n.links = []; },
      };
      return n;
    };
    return { createGain: node, createChannelMerger: node } as unknown as BaseAudioContext;
  }

  it('wires one mono gain per ACN channel into its own merger input', () => {
    const encoder = new AmbisonicMonoEncoder(fakeContext(), 3);
    expect(encoder.gainNodes).toHaveLength(16);
    encoder.gainNodes.forEach((g, ch) => {
      const fake = g as unknown as { links: { to: unknown; input: number }[]; channelCount: number };
      expect(fake.channelCount).toBe(1);
      expect(fake.links).toEqual([{ to: encoder.out, input: ch }]);
    });
  });

  it('writes SN3D gains for the requested direction', () => {
    const encoder = new AmbisonicMonoEncoder(fakeContext(), 1);
    encoder.setDirection(90 * DEG, 0); // hard left: W = 1, Y = 1, Z = X = 0
    const gains = encoder.gainNodes.map((g) => g.gain.value);
    expect(gains[0]).toBeCloseTo(1);
    expect(gains[1]).toBeCloseTo(1);
    expect(gains[2]).toBeCloseTo(0);
    expect(gains[3]).toBeCloseTo(0);
  });
});
