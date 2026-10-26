import { describe, it, expect } from 'vitest';
import { AmbisonicConvolver } from './ambisonic-convolver';

/** Minimal Web Audio stand-ins (Node has no Web Audio): nodes record their connections. */
interface FakeNode {
  kind: string;
  buffer?: AudioBuffer | null;
  normalize?: boolean;
  links: { to: FakeNode; input: number }[];
  connect: (to: FakeNode, output?: number, input?: number) => void;
  disconnect: (to?: FakeNode) => void;
}

function fakeNode(kind: string): FakeNode {
  const node: FakeNode = {
    kind,
    links: [],
    connect: (to, _output = 0, input = 0) => { node.links.push({ to, input }); },
    disconnect: (to) => { node.links = to ? node.links.filter((l) => l.to !== to) : []; },
  };
  return node;
}

function fakeBuffer(channels: number, length: number, sampleRate = 48000): AudioBuffer {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    getChannelData: (ch: number) => data[ch],
  } as unknown as AudioBuffer;
}

function fakeContext() {
  const convolvers: FakeNode[] = [];
  const ctx = {
    createGain: () => fakeNode('gain'),
    createChannelMerger: () => fakeNode('merger'),
    createConvolver: () => {
      const node = fakeNode('convolver');
      convolvers.push(node);
      return node;
    },
    createBuffer: (channels: number, length: number, sampleRate: number) => fakeBuffer(channels, length, sampleRate),
  } as unknown as BaseAudioContext;
  return { ctx, convolvers };
}

/** FOA filter with a short decaying impulse on the given ACN channels only. */
function foaFilter(activeChannels: number[]): AudioBuffer {
  const buffer = fakeBuffer(4, 8);
  for (const ch of activeChannels) {
    const data = buffer.getChannelData(ch);
    data[0] = 1;
    data[3] = 0.25;
  }
  return buffer;
}

describe('AmbisonicConvolver', () => {
  it('builds one ConvolverNode for a mono IR stored as FOA (W only)', () => {
    const { ctx, convolvers } = fakeContext();
    const conv = new AmbisonicConvolver(ctx, 1);
    conv.updateFilters(foaFilter([0]));

    expect(conv.activeChannels).toBe(1);
    expect(convolvers).toHaveLength(1);
    // W feeds merger input 0 and keeps its samples
    const node = convolvers[0];
    expect(node.links).toEqual([{ to: conv.out as unknown as FakeNode, input: 0 }]);
    expect(node.normalize).toBe(false);
    expect(Array.from(node.buffer!.getChannelData(0))).toEqual([1, 0, 0, 0.25, 0, 0, 0, 0]);
  });

  it('routes each non-silent channel to its own ACN merger input', () => {
    const { ctx, convolvers } = fakeContext();
    const conv = new AmbisonicConvolver(ctx, 1);
    conv.updateFilters(foaFilter([0, 2, 3]));

    expect(conv.activeChannels).toBe(3);
    expect(convolvers.map((n) => n.links[0].input)).toEqual([0, 2, 3]);
  });

  it('renders an all-zero filter with no ConvolverNode at all', () => {
    const { ctx, convolvers } = fakeContext();
    const conv = new AmbisonicConvolver(ctx, 1);
    conv.updateFilters(foaFilter([]));

    expect(conv.isSilent).toBe(true);
    expect(convolvers).toHaveLength(0);
  });

  it('releases the previous nodes when a new filter is loaded', () => {
    const { ctx, convolvers } = fakeContext();
    const conv = new AmbisonicConvolver(ctx, 1);
    conv.updateFilters(foaFilter([0, 1, 2, 3]));
    const first = convolvers.slice();
    conv.updateFilters(foaFilter([0]));

    expect(conv.activeChannels).toBe(1);
    for (const node of first) expect(node.links).toHaveLength(0);
    const input = conv.in as unknown as FakeNode;
    expect(input.links.map((l) => l.to)).toEqual([convolvers[4]]);
  });
});
