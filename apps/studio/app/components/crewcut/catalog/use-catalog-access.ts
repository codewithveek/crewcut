import { useActionQuery } from "@agent-native/core/client/hooks";

export interface CatalogAccess {
  admin: boolean;
  workspace: string;
  plan: "free" | "pro";
}

/** Whether the signed-in person is a catalog admin, and their workspace's plan. Cached for the session. */
export function useCatalogAccess(): CatalogAccess | null {
  const query = useActionQuery("get-catalog-access", {} as never, { staleTime: 5 * 60 * 1000 } as never);
  return (query.data as CatalogAccess | undefined) ?? null;
}
