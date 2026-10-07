'use client';

import { createContext, useCallback, useContext, type ReactNode } from 'react';

/**
 * Modified-field marks for generated-card settings editors.
 *
 * A generated card's settings section wraps its editors in
 * `<ModifiedFieldsProvider fields={...}>` (keys from
 * `utils/generationSignature.getModifiedGenerationFields`). Editors ask
 * `useIsFieldModified()(key)` and pass the result to a control's `modified`
 * prop, or render `<ModifiedMark />` after a raw label. Outside a provider
 * (pending cards) nothing is ever marked.
 *
 * **Usage:**
 * ```tsx
 * const isModified = useIsFieldModified();
 * <RangeSlider label="Duration" modified={isModified('duration')} ... />
 * <label>Context{isModified('userContext') && <ModifiedMark />}</label>
 * ```
 */

const EMPTY_FIELDS: ReadonlySet<string> = new Set();

const ModifiedFieldsContext = createContext<ReadonlySet<string>>(EMPTY_FIELDS);

export function ModifiedFieldsProvider({
  fields,
  children,
}: {
  fields?: ReadonlySet<string>;
  children: ReactNode;
}) {
  return (
    <ModifiedFieldsContext.Provider value={fields ?? EMPTY_FIELDS}>
      {children}
    </ModifiedFieldsContext.Provider>
  );
}

/** Returns a predicate telling whether a settings field was edited since generation. */
export function useIsFieldModified(): (field: string) => boolean {
  const fields = useContext(ModifiedFieldsContext);
  return useCallback((field: string) => fields.has(field), [fields]);
}

/** "*" suffix flagging a label whose value changed since the last generation. */
export function ModifiedMark() {
  return (
    <span className="modified-mark" title="Changed since last generation" aria-label="modified">
      *
    </span>
  );
}

/**
 * Corner "*" for an unlabeled field (e.g. a prompt textarea). The field's
 * wrapper must be `position: relative`.
 */
export function ModifiedCornerMark({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="modified-mark modified-mark--corner" title="Changed since last generation" aria-label="modified">
      *
    </span>
  );
}
