/**
 * Shared ConfirmDialog — re-export from the ui/ primitive.
 * Keeps the imports stable across business modules so UX conventions can
 * evolve without touching every consumer.
 */
export { default } from '@/components/ui/ConfirmDialog';
export type { ConfirmDialogProps } from '@/components/ui/ConfirmDialog';
