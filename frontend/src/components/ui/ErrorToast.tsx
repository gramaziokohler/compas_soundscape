"use client";

import { useErrorsStore } from '@/store';
import { UI_CARD, UI_SHADOWS, UI_TRANSITIONS } from '@/utils/constants';
import { CardButton, CloseIcon } from './Card';

export function ErrorToast() {
  const { errors, removeError } = useErrorsStore();

  if (errors.length === 0) return null;

  return (
    <div
      className="fixed top-4 right-4 z-[9999] flex flex-col gap-2"
      style={{ maxWidth: '400px' }}
    >
      {errors.map((error) => {
        const typeClasses = error.type === 'error'
          ? 'bg-error-light border-error text-error'
          : error.type === 'warning'
            ? 'bg-warning-light border-warning text-warning'
            : 'bg-info-light border-info text-info';

        return (
          <div
            key={error.id}
            className={`rounded-lg border flex items-start gap-3 animate-slide-in-right ${typeClasses}`}
            style={{
              padding: `${UI_CARD.PADDING}px`,
              boxShadow: UI_SHADOWS.LG,
              transition: UI_TRANSITIONS.SLOW
            }}
          >
            {/* Icon */}
            <div style={{ fontSize: '18px', lineHeight: '1', marginTop: '2px' }}>
              {error.type === 'error' ? '⚠️' : error.type === 'warning' ? '⚡' : 'ℹ️'}
            </div>

            {/* Message */}
            <div className="flex-1 text-sm">
              {error.message}
            </div>

            {/* Close button */}
            <CardButton
              icon={<CloseIcon />}
              title="Dismiss notification"
              onClick={() => removeError(error.id)}
              variant="close"
            />
          </div>
        );
      })}

      <style jsx>{`
        @keyframes slide-in-right {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }

        .animate-slide-in-right {
          animation: slide-in-right 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
