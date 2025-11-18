/**
 * AmbisonicOrderSelector Component
 *
 * Selector for ambisonic order (FOA/SOA/TOA) with browser support indication.
 * Only visible when in AMBISONIC_IR mode.
 *
 * Features:
 * - FOA (4ch), SOA (9ch), TOA (16ch) options
 * - Browser support badges (✓ supported, ✗ unsupported)
 * - Visual channel count indication
 * - Disable unsupported orders
 * - Color-coded order types
 *
 * Usage:
 * ```tsx
 * <AmbisonicOrderSelector
 *   currentOrder={1}
 *   onOrderChange={(order) => setAmbisonicOrder(order)}
 *   supportedOrders={{ foa: true, soa: true, toa: false }}
 * />
 * ```
 */

'use client';

import React from 'react';
import { AmbisonicOrder } from '@/types/audio';
import {
  AMBISONIC_ORDER_INFO,
  UI_COLORS,
  UI_BORDER_RADIUS,
  UI_SPACING,
  UI_FONT_SIZE,
  UI_TRANSITIONS,
  UI_SHADOWS,
} from '@/lib/constants';

interface AmbisonicOrderSelectorProps {
  currentOrder: AmbisonicOrder;
  onOrderChange: (order: AmbisonicOrder) => void;
  supportedOrders: {
    foa: boolean;
    soa: boolean;
    toa: boolean;
  };
  className?: string;
}

export function AmbisonicOrderSelector({
  currentOrder,
  onOrderChange,
  supportedOrders,
  className = '',
}: AmbisonicOrderSelectorProps) {
  // Map order number to support flag
  const isSupportedMap: Record<AmbisonicOrder, boolean> = {
    1: supportedOrders.foa,
    2: supportedOrders.soa,
    3: supportedOrders.toa,
  };

  const orders: AmbisonicOrder[] = [1, 2, 3];

  return (
    <div className={`flex flex-col ${className}`} style={{ gap: UI_SPACING.SM }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <label
          className="text-xs font-medium"
          style={{ color: UI_COLORS.NEUTRAL_700 }}
        >
          Ambisonic Order
        </label>
        <span
          className="text-xs font-mono"
          style={{ color: UI_COLORS.NEUTRAL_500 }}
        >
          {AMBISONIC_ORDER_INFO[currentOrder].channels}ch
        </span>
      </div>

      {/* Order Buttons */}
      <div
        className="flex gap-2"
        style={{ fontSize: UI_FONT_SIZE.SM }}
      >
        {orders.map((order) => {
          const info = AMBISONIC_ORDER_INFO[order];
          const isSelected = order === currentOrder;
          const isSupported = isSupportedMap[order];

          // Color based on order
          const orderColor =
            order === 1
              ? UI_COLORS.INFO
              : order === 2
              ? UI_COLORS.SUCCESS
              : UI_COLORS.SECONDARY;

          return (
            <button
              key={order}
              onClick={() => isSupported && onOrderChange(order)}
              disabled={!isSupported}
              className={`
                flex-1 relative p-3 text-left
                transition-all duration-200
                ${!isSupported ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:scale-[1.02]'}
              `}
              style={{
                backgroundColor: isSelected
                  ? `${orderColor}15`
                  : UI_COLORS.NEUTRAL_100,
                borderRadius: UI_BORDER_RADIUS.MD,
                border: `1px solid ${isSelected ? orderColor : UI_COLORS.NEUTRAL_300}`,
                boxShadow: isSelected ? UI_SHADOWS.MD : UI_SHADOWS.SM,
                transition: UI_TRANSITIONS.NORMAL,
                ...(isSelected && { outline: `2px solid ${orderColor}`, outlineOffset: '1px' }),
              }}
            >
              {/* Icon and Name */}
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-base">{info.icon}</span>
                  <span
                    className="font-semibold"
                    style={{
                      color: isSelected ? orderColor : UI_COLORS.NEUTRAL_800,
                      fontSize: UI_FONT_SIZE.SM,
                    }}
                  >
                    {info.name}
                  </span>
                </div>

                {/* Support Badge */}
                <span
                  className="px-1.5 py-0.5 text-xs font-bold rounded"
                  style={{
                    backgroundColor: isSupported
                      ? `${UI_COLORS.SUCCESS}20`
                      : `${UI_COLORS.ERROR}20`,
                    color: isSupported ? UI_COLORS.SUCCESS : UI_COLORS.ERROR,
                    fontSize: '10px',
                  }}
                >
                  {isSupported ? '✓' : '✗'}
                </span>
              </div>

              {/* Channel Count */}
              <div
                className="text-xs font-mono mb-1"
                style={{ color: UI_COLORS.NEUTRAL_600 }}
              >
                {info.channels} channels
              </div>

              {/* Description */}
              <p
                className="text-xs leading-tight"
                style={{
                  color: UI_COLORS.NEUTRAL_600,
                  fontSize: '11px',
                }}
              >
                {info.description}
              </p>

              {/* Selected Indicator */}
              {isSelected && (
                <div
                  className="absolute top-2 right-2 w-2 h-2 rounded-full"
                  style={{ backgroundColor: orderColor }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Info Box */}
      <div
        className="p-2 text-xs rounded"
        style={{
          backgroundColor: `${UI_COLORS.INFO}08`,
          borderRadius: UI_BORDER_RADIUS.SM,
          color: UI_COLORS.NEUTRAL_700,
          fontSize: '11px',
        }}
      >
        <span style={{ color: UI_COLORS.INFO, fontWeight: 500 }}>
          {AMBISONIC_ORDER_INFO[currentOrder].fullName}
        </span>
        <br />
        Higher orders provide better spatial resolution but require more CPU.
        Browser support varies by order.
      </div>

      {/* Unsupported Warning */}
      {!supportedOrders.toa && (
        <div
          className="p-2 text-xs rounded flex items-start gap-2"
          style={{
            backgroundColor: `${UI_COLORS.WARNING}10`,
            borderRadius: UI_BORDER_RADIUS.SM,
            color: UI_COLORS.NEUTRAL_600,
            fontSize: '11px',
          }}
        >
          <span>⚠️</span>
          <span>
            Some orders are not supported by your browser. Unsupported orders are disabled.
          </span>
        </div>
      )}
    </div>
  );
}
