'use client';

import { useState } from 'react';

interface DAWGroupProps {
  groupName: string;
  soundCount: number;
  children: React.ReactNode;
}

export function DAWGroup({ groupName, soundCount, children }: DAWGroupProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Group header */}
      <div
        onClick={() => setIsCollapsed((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          height: '22px',
          paddingLeft: '8px',
          paddingRight: '8px',
          backgroundColor: 'var(--color-border)',
          borderBottom: '1px solid var(--color-border)',
          cursor: 'pointer',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        {/* Chevron */}
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          style={{
            transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
            flexShrink: 0,
            color: 'var(--foreground)',
            opacity: 0.6,
          }}
        >
          <path d="M2 3 L5 7 L8 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        {/* Group name */}
        <span
          style={{
            fontSize: '10px',
            fontWeight: 600,
            color: 'var(--foreground)',
            opacity: 0.7,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {groupName}
        </span>

        {/* Count badge */}
        <span
          style={{
            fontSize: '9px',
            color: 'var(--color-text-3)',
            backgroundColor: 'var(--color-border)',
            borderRadius: '8px',
            padding: '0 5px',
            lineHeight: '14px',
          }}
        >
          {soundCount}
        </span>
      </div>

      {/* Tracks */}
      {!isCollapsed && children}
    </div>
  );
}
