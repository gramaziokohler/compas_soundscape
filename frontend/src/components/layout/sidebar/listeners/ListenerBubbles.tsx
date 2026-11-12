'use client';

import { useState, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import type { CardType, CustomMenuItem } from '@/types/card';
import type { CardTypeOption } from '@/components/ui/CardSection';
import type { ListenerItemConfig } from './listenerItems';
import { useUIStore } from '@/store';
import { Bubble, BubbleAddButton, BubbleExitButton, BubbleHeading } from '@/components/ui/Bubble';
import { ListenerIcon, ListenerGridIcon } from '@/components/ui/BubbleIcons';
import { ContextMenu } from '@/components/ui/ContextMenu';
import { CardContextMenu } from '@/components/ui/CardContextMenu';
import { BubbleScrollColumn } from '@/components/ui/BubbleScrollColumn';
import { FpsHelpPopup } from '@/components/scene/FpsHelpPopup';
import { useDismissOnSceneClick } from '@/hooks/useDismissOnSceneClick';
import { useBubbleColumnSpace } from '@/hooks/useBubbleColumnSpace';
import { useBubbleFrontLayer } from '@/hooks/useBubbleFrontLayer';
import { columnHeight, windowLayout } from '@/utils/bubbleOverflow';
import { FPS_CONTROLS_HINT, SIMPLE_MODE } from '@/utils/constants';
import { useCanEdit } from '@/hooks/useCanEdit';
import { useShareLinkedIds } from '@/hooks/useShareLinkedIds';
import { useActiveSceneId } from '@/hooks/useActiveSceneId';

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
  /** Right-click menu rows — the expanded card's own. Omit to disable the menu (read-only). */
  buildMenu?: (item: ListenerItemConfig) => CustomMenuItem[];
  /** "Rename" row of the menu: opens the card with its title editable. */
  onRename?: (item: ListenerItemConfig) => void;
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

/** A single listener can always be powered; a grid only once it has points. */
function isClickPowerable(item: ListenerItemConfig | undefined): boolean {
  return !!item && (item.type === 'listener' || item.points.length > 0);
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
  openIndex: openIndexProp,
  isFpsMode,
  onTogglePower,
  buildMenu,
  onRename,
  onExitFps,
  onOpenChange,
  onAddItem,
  renderCard,
}: ListenerBubblesProps) {
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  const [itemMenu, setItemMenu] = useState<{ x: number; y: number; item: ListenerItemConfig } | null>(null);
  const columnSpace = useBubbleColumnSpace();
  const fpsRowRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  // Distance (px) from the column bottom to the open bubble's bottom edge.
  const [panelLift, setPanelLift] = useState(0);
  // Share view: a listener has nothing to edit — a click powers it, no card opens.
  const canEdit = useCanEdit();
  const openIndex = canEdit ? openIndexProp : null;

  // Share view: only the listeners linked to the powered scene (null = all).
  const linkedIds = useShareLinkedIds('listener');
  const shown = useMemo(
    () => items.map((item, index) => ({ item, index })).filter(({ item }) => !linkedIds || linkedIds.has(item.id)),
    [items, linkedIds],
  );
  const itemCount = shown.length;

  // On a scene switch, leave a powered listener that is no longer listed
  // (useShareLinkActivation then powers the newly linked one).
  const activeSceneId = useActiveSceneId();
  useEffect(() => {
    const active = activeIndex !== null ? items[activeIndex] : undefined;
    if (linkedIds && active && !linkedIds.has(active.id)) onTogglePower(null);
    // Only on a scene change: a link group activated from a simulation may power any listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSceneId]);

  // Acoustics and Listeners share the right edge's height budget.
  useEffect(() => {
    useUIStore.getState().setBubbleColumnCount('listeners', itemCount);
    return () => useUIStore.getState().setBubbleColumnCount('listeners', 0);
  }, [itemCount]);

  useDismissOnSceneClick(() => onOpenChange(null), openIndex !== null);

  const size = SIMPLE_MODE.BUBBLE_SIZE;
  const bottom = columnSpace.listenersBottom;
  const layout = windowLayout(itemCount, columnSpace.listeners);
  // The share view has no "+" under the bubbles: the heading sits right above them.
  const headingBottom = bottom + columnHeight(layout.visibleSlots, layout.overflow, canEdit) + SIMPLE_MODE.BUBBLE_GAP;
  const openItem = openIndex !== null ? items[openIndex] : undefined;
  // The open card and the docked DAW overlap: whichever was clicked last is on top.
  const frontLayer = useBubbleFrontLayer(openIndex);
  const activeItem = activeIndex !== null ? items[activeIndex] : undefined;
  // Exit button + help popup beside the powered bubble while its card is closed
  // (the open card shows the FPS notice itself).
  const isFpsActive = isFpsMode && !!activeItem && openIndex !== activeIndex;
  // The column scrolls by bubble position, which differs from the item index once filtered.
  const activePosition = shown.findIndex((s) => s.index === activeIndex);
  const openPosition = shown.findIndex((s) => s.index === openIndex);
  const focusPosition = openPosition >= 0 ? openPosition : activePosition;

  // The open card lines up with its bubble. Re-measured whenever the column's
  // rows change (scrolling the window re-slices them). offsetTop is relative to
  // the fixed column and ignores the window's slide transform.
  const openItemId = openItem?.id ?? null;
  useLayoutEffect(() => {
    if (openItemId === null) return;
    const column = document.getElementById(SIMPLE_MODE.LISTENERS_COLUMN_ID);
    if (!column) return;
    const measure = () => {
      const row = rowRefs.current.get(openItemId);
      setPanelLift(row && row.offsetParent === column
        ? Math.max(0, column.offsetHeight - row.offsetTop - row.offsetHeight)
        : 0);
    };
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(column, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [openItemId, itemCount, layout.visibleSlots, layout.overflow]);

  const handleClick = (index: number) => {
    if (!canEdit) {
      if (isClickPowerable(items[index])) onTogglePower(activeIndex === index ? null : index);
      return;
    }
    onOpenChange(openIndex === index ? null : index);
  };

  return (
    <>
      <BubbleHeading style={{ right: SIMPLE_MODE.EDGE_MARGIN, bottom: headingBottom }}>Listeners</BubbleHeading>
      <BubbleScrollColumn
        id={SIMPLE_MODE.LISTENERS_COLUMN_ID}
        className="transition-all duration-300"
        availablePx={columnSpace.listeners}
        focusIndex={focusPosition >= 0 ? focusPosition : null}
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
        items={shown.map(({ item, index }) => {
          const active = activeIndex === index;
          const showExit = active && isFpsActive;
          const action = !canEdit
            ? active ? 'click to turn off' : 'click to listen'
            : openIndex === index ? 'click to reduce' : 'click to open';
          const powerTitle = item.type === 'grid-listener'
            ? active ? 'Hide grid points' : 'Show grid points'
            : active ? 'Leave first-person view' : 'Listen here (first-person view)';
          return (
            <div
              key={item.id}
              ref={(el) => {
                if (el) rowRefs.current.set(item.id, el);
                else rowRefs.current.delete(item.id);
                if (showExit) fpsRowRef.current = el;
              }}
              className="flex items-center"
              style={{ gap: SIMPLE_MODE.BUBBLE_GAP }}
            >
            {showExit && <BubbleExitButton id={FPS_CONTROLS_HINT.EXIT_BUTTON_ID} label="Leave FPS view" labelSide="left" onClick={onExitFps} />}
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
              onTogglePower={isClickPowerable(item) ? () => onTogglePower(active ? null : index) : undefined}
              powerTitle={powerTitle}
              onContextMenu={buildMenu
                ? (e) => setItemMenu({ x: e.clientX, y: e.clientY, item })
                : undefined}
            />
            </div>
          );
        })}
      />

      {/* The share view has its own FPS strip (FpsControlsHint) instead. */}
      {canEdit && <FpsHelpPopup active={isFpsActive} anchorRef={fpsRowRef} />}

      {addMenu && (
        <ContextMenu
          x={addMenu.x}
          y={addMenu.y}
          title="Add listener"
          items={availableTypes.map((t) => ({ key: t.type, label: t.label, onClick: () => onAddItem(t.type) }))}
          onClose={() => setAddMenu(null)}
        />
      )}

      {itemMenu && buildMenu && (
        <CardContextMenu
          x={itemMenu.x}
          y={itemMenu.y}
          items={buildMenu(items.find((i) => i.id === itemMenu.item.id) ?? itemMenu.item)}
          onRename={onRename ? () => onRename(itemMenu.item) : undefined}
          onClose={() => setItemMenu(null)}
        />
      )}

      {openItem && openIndex !== null && (
        // Bottom-aligned box over the panel's allowed area. The spacer under the
        // card lifts it level with its bubble and shrinks first when the card is
        // too tall, so the card slides down instead of leaving the screen.
        <div
          className="fixed flex flex-col justify-end pointer-events-none"
          style={{
            right: SIMPLE_MODE.EDGE_MARGIN + size + SIMPLE_MODE.PANEL_GAP,
            bottom,
            width: SIMPLE_MODE.PANEL_WIDTH,
            height: SIMPLE_MODE.PANEL_MAX_HEIGHT,
            zIndex: frontLayer.zIndex,
          }}
        >
          <div
            className="bubble-card-host pointer-events-auto"
            onPointerDownCapture={frontLayer.onPointerDownCapture}
            style={{ position: 'relative', maxHeight: '100%', flexShrink: 0 }}
          >
            {renderCard(openItem, openIndex, true, () => onOpenChange(null), {
              onReduce: () => onOpenChange(null),
            })}
          </div>
          <div aria-hidden style={{ height: panelLift, flexShrink: 1, minHeight: 0 }} />
        </div>
      )}
    </>
  );
}
