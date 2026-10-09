'use client';

import { useState, useEffect, useRef, type ReactNode } from 'react';
import type { CardType, CustomMenuItem } from '@/types/card';
import type { CardTypeOption } from '@/components/ui/CardSection';
import type { ListenerItemConfig } from './listenerItems';
import { useUIStore } from '@/store';
import { Bubble, BubbleAddButton, BubbleExitButton, BubbleHeading } from '@/components/ui/Bubble';
import { ListenerIcon, ListenerGridIcon } from '@/components/ui/BubbleIcons';
import { ContextMenu } from '@/components/ui/ContextMenu';
import { BubbleScrollColumn } from '@/components/ui/BubbleScrollColumn';
import { FpsHelpPopup } from '@/components/scene/FpsHelpPopup';
import { useDismissOnSceneClick } from '@/hooks/useDismissOnSceneClick';
import { useBubbleColumnSpace } from '@/hooks/useBubbleColumnSpace';
import { useBubbleFrontLayer } from '@/hooks/useBubbleFrontLayer';
import { columnHeight, windowLayout } from '@/utils/bubbleOverflow';
import { SIMPLE_MODE } from '@/utils/constants';

/** Extra Card props used when a card floats beside its bubble (Simple mode). */
export interface FloatingCardOptions {
  onReduce: () => void;
  extraMenu?: CustomMenuItem[];
}

interface ListenerBubblesProps {
  items: ListenerItemConfig[];
  availableTypes: CardTypeOption[];
  /** Index of the powered listener (FPS view / grid points shown), or null. */
  activeIndex: number | null;
  /** Index of the listener whose card floats open, or null. */
  openIndex: number | null;
  /** Viewer locked in a first-person view (single listener, or a grid point of the powered grid). */
  isFpsMode: boolean;
  /** Power a listener on (index) or switch the powered one off (null). */
  onTogglePower: (index: number | null) => void;
  /** Leave the FPS view (a grid stays powered, a single listener powers off). */
  onExitFps: () => void;
  onOpenChange: (index: number | null) => void;
  onAddItem: (type: CardType) => void;
  renderCard: (
    item: ListenerItemConfig,
    index: number,
    isExpanded: boolean,
    onToggleExpand: (i: number) => void,
    floating?: FloatingCardOptions,
  ) => ReactNode;
}

/** A listener is "ready" once it takes part in simulations (grids also need points). */
function isListenerReady(item: ListenerItemConfig): boolean {
  if (item.hiddenForSimulation) return false;
  return item.type === 'listener' || item.points.length > 0;
}

/**
 * Bottom-right stack of listener bubbles, growing upward from the corner ("+"
 * nearest the corner), just above the scene bottom bar (and the docked DAW).
 * Click a listener → open / reduce its card, which floats beside the stack (no
 * wrapper). Ready listeners carry a power button in their hover flyout
 * (first-person view for a single listener, show a grid's points). A viewer
 * click on a listener opens its card too. While a single listener is powered with its
 * card closed, a red exit button to its left leaves the first-person view, and
 * the first time ever a help popup explains the FPS controls.
 */
export function ListenerBubbles({
  items,
  availableTypes,
  activeIndex,
  openIndex,
  isFpsMode,
  onTogglePower,
  onExitFps,
  onOpenChange,
  onAddItem,
  renderCard,
}: ListenerBubblesProps) {
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  const columnSpace = useBubbleColumnSpace();
  const itemCount = items.length;
  const fpsRowRef = useRef<HTMLDivElement>(null);

  // Acoustics and Listeners share the right edge's height budget.
  useEffect(() => {
    useUIStore.getState().setBubbleColumnCount('listeners', itemCount);
    return () => useUIStore.getState().setBubbleColumnCount('listeners', 0);
  }, [itemCount]);

  useDismissOnSceneClick(() => onOpenChange(null), openIndex !== null);

  const size = SIMPLE_MODE.BUBBLE_SIZE;
  const bottom = columnSpace.listenersBottom;
  const layout = windowLayout(itemCount, columnSpace.listeners);
  const headingBottom = bottom + columnHeight(layout.visibleSlots, layout.overflow) + SIMPLE_MODE.BUBBLE_GAP;
  const openItem = openIndex !== null ? items[openIndex] : undefined;
  // The open card and the docked DAW overlap: whichever was clicked last is on top.
  const frontLayer = useBubbleFrontLayer(openIndex);
  const activeItem = activeIndex !== null ? items[activeIndex] : undefined;
  // Exit button + help popup beside the powered bubble while its card is closed
  // (the open card shows the FPS notice itself).
  const isFpsActive = isFpsMode && !!activeItem && openIndex !== activeIndex;

  const handleClick = (index: number) => {
    onOpenChange(openIndex === index ? null : index);
  };

  return (
    <>
      <BubbleHeading style={{ right: SIMPLE_MODE.EDGE_MARGIN, bottom: headingBottom }}>Listeners</BubbleHeading>
      <BubbleScrollColumn
        id={SIMPLE_MODE.LISTENERS_COLUMN_ID}
        className="transition-all duration-300"
        availablePx={columnSpace.listeners}
        focusIndex={activeIndex}
        direction="up"
        align="flex-end"
        labelSide="left"
        tone="listener"
        style={{ right: SIMPLE_MODE.EDGE_MARGIN, bottom, zIndex: SIMPLE_MODE.Z_INDEX }}
        addButton={
          <BubbleAddButton
            label="Add listener"
            labelSide="left"
            tone="listener"
            size={size}
            active={addMenu !== null}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              // Opens up-left of the corner; ContextMenu clamps into the viewport.
              setAddMenu({ x: rect.left, y: rect.top });
            }}
          />
        }
        items={items.map((item, index) => {
          const active = activeIndex === index;
          const showExit = active && isFpsActive;
          const action = openIndex === index ? 'click to reduce' : 'click to open';
          const powerTitle = item.type === 'grid-listener'
            ? active ? 'Hide grid points' : 'Show grid points'
            : active ? 'Leave first-person view' : 'Listen here (first-person view)';
          return (
            <div
              key={item.id}
              ref={showExit ? fpsRowRef : undefined}
              className="flex items-center"
              style={{ gap: SIMPLE_MODE.BUBBLE_GAP }}
            >
            {showExit && <BubbleExitButton label="Leave FPS view" labelSide="left" onClick={onExitFps} />}
            <Bubble
              label={item.name}
              detail={`${active ? 'Active' : item.type === 'grid-listener' ? 'Grid listener' : 'Listener'} — ${action}`}
              icon={item.type === 'grid-listener' ? <ListenerGridIcon size={size / 2} /> : <ListenerIcon size={size / 2} />}
              size={size}
              labelSide="left"
              ready={isListenerReady(item)}
              selected={active}
              tone="listener"
              onClick={() => handleClick(index)}
              onTogglePower={item.type === 'listener' || item.points.length > 0 ? () => onTogglePower(active ? null : index) : undefined}
              powerTitle={powerTitle}
            />
            </div>
          );
        })}
      />

      <FpsHelpPopup active={isFpsActive} anchorRef={fpsRowRef} />

      {addMenu && (
        <ContextMenu
          x={addMenu.x}
          y={addMenu.y}
          title="Add listener"
          items={availableTypes.map((t) => ({ key: t.type, label: t.label, onClick: () => onAddItem(t.type) }))}
          onClose={() => setAddMenu(null)}
        />
      )}

      {openItem && openIndex !== null && (
        <div
          className="bubble-card-host"
          onPointerDownCapture={frontLayer.onPointerDownCapture}
          style={{
            right: SIMPLE_MODE.EDGE_MARGIN + size + SIMPLE_MODE.PANEL_GAP,
            bottom,
            width: SIMPLE_MODE.PANEL_WIDTH,
            maxHeight: SIMPLE_MODE.PANEL_MAX_HEIGHT,
            zIndex: frontLayer.zIndex,
          }}
        >
          {renderCard(openItem, openIndex, true, () => onOpenChange(null), {
            onReduce: () => onOpenChange(null),
          })}
        </div>
      )}
    </>
  );
}
