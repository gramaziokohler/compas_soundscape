/**
 * IR Status Notice
 *
 * Displays the current IR status, DOF description, and receiver mode state.
 * Shows helpful information about spatial audio capabilities.
 */

'use client';

import React from 'react';
import { UI_COLORS } from '@/lib/constants';

interface IRStatusNoticeProps {
  message: string;
  dofDescription: string;
  isActive: boolean;
  className?: string;
}

export function IRStatusNotice({
  message,
  dofDescription,
  isActive,
  className = ''
}: IRStatusNoticeProps) {
  const bgColor = isActive ? '#E0F2FE' : '#FEF3C7';
  const borderColor = isActive ? '#0EA5E9' : '#F59E0B';
  const textColor = isActive ? '#0C4A6E' : '#92400E';
  const iconColor = isActive ? '#0EA5E9' : '#F59E0B';

  return (
    <div
      className={`fixed top-20 left-1/2 transform -translate-x-1/2 z-50 ${className}`}
      style={{
        maxWidth: '600px',
        width: '90%'
      }}
    >
      <div
        className="p-3 rounded-lg shadow-lg flex items-start gap-3"
        style={{
          backgroundColor: bgColor,
          borderLeft: `4px solid ${borderColor}`
        }}
      >
        {/* Icon */}
        <div className="flex-shrink-0 mt-0.5">
          {isActive ? (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke={iconColor}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="22"/>
            </svg>
          ) : (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke={iconColor}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
              <path d="M12 9v4"/>
              <path d="M12 17h.01"/>
            </svg>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium" style={{ color: textColor }}>
            {message}
          </p>
          <p className="text-xs mt-1" style={{ color: textColor, opacity: 0.8 }}>
            {dofDescription}
          </p>
          {!isActive && (
            <p className="text-xs mt-1 font-medium" style={{ color: textColor }}>
              💡 Enter receiver mode (first-person view) to activate IR
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
