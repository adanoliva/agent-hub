import { useStore } from '../store';

export function useCategoryHelpers() {
  const config = useStore((s) => s.config);

  const catName = (id: string) =>
    config?.categories.find((c) => c.id === id)?.name ?? id;

  const catColor = (id: string) =>
    config?.categories.find((c) => c.id === id)?.color ?? '#888';

  const techName = (catId: string, techId: string) => {
    const cat = config?.categories.find((c) => c.id === catId);
    return cat?.technologies.find((t) => t.id === techId)?.name ?? techId;
  };

  return { catName, catColor, techName };
}
