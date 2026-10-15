export const WORKLIST_PAGE_SIZE = 50;

export type WorklistPage<T> = { items: T[]; total: number; limit: number; offset: number };

export function nextWorklistOffset(page: WorklistPage<unknown>) {
  const next = page.offset + page.items.length;
  return page.items.length === page.limit && next < page.total ? next : undefined;
}

// One cache entry per filter, with RTK owning all its pages. Invalidation and
// refresh replace the entire entry with page one instead of retaining old tails.
export const worklistOptions = {
  initialPageParam: 0,
  refetchCachedPages: false,
  getNextPageParam: nextWorklistOffset,
};

export function worklistItems<T>(data: { pages: WorklistPage<T>[] } | undefined, id: (item: T) => string): T[] {
  const items = new Map<string, T>();
  for (const page of data?.pages ?? []) {
    for (const item of page.items) if (!items.has(id(item))) items.set(id(item), item);
  }
  return [...items.values()];
}
