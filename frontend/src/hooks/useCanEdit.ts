import { useShareViewStore, selectIsShareView } from '@/store';

/**
 * False in the public read-only share view (`/share/<id>`). Every editing
 * control (add / delete / rename / drag / generate / settings) gates on this.
 *
 * Usage:
 * ```tsx
 * const canEdit = useCanEdit();
 * {canEdit && <DeleteButton />}
 * ```
 */
export function useCanEdit(): boolean {
  return !useShareViewStore(selectIsShareView);
}
