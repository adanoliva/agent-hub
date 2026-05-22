import { useStore } from '../store';
import type { ToastType } from '../types';

export function useToast() {
  const addToast = useStore((s) => s.addToast);
  return (msg: string, type: ToastType = 'ok') => addToast(msg, type);
}
