import type { ReceiverData, GridListenerData } from '@/types/receiver';

// Unified listener card item (single + grid) satisfying CardBaseConfig
export type SingleListenerConfig = ReceiverData & { type: 'listener'; display_name?: string };
export type GridListenerConfig = GridListenerData & { type: 'grid-listener'; display_name?: string };
export type ListenerItemConfig = SingleListenerConfig | GridListenerConfig;
