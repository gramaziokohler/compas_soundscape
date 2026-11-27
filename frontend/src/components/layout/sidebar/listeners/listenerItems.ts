import type { ReceiverData, GridListenerData } from '@/types/receiver';
import type { HeatmapListenerData } from '@/types/heatmap';

// Unified listener card item (single + grid + heatmap) satisfying CardBaseConfig
export type SingleListenerConfig = ReceiverData & { type: 'listener'; display_name?: string };
export type GridListenerConfig = GridListenerData & { type: 'grid-listener'; display_name?: string };
export type HeatmapListenerConfig = HeatmapListenerData & { type: 'heatmap-listener'; display_name?: string };
export type ListenerItemConfig = SingleListenerConfig | GridListenerConfig | HeatmapListenerConfig;
