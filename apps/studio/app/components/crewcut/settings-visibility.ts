import { CORE_SETTINGS_PAGES, registerSettingsPages } from "@agent-native/toolkit/app/settings";
import { useEffect } from "react";

import { useCatalogAccess } from "./catalog/use-catalog-access";

/**
 * Core Settings pages only Crewcut's operators see: the deployment's own
 * plumbing (infrastructure, audit log, apps, sign-in) and agent internals a
 * video maker has no use for. Operators are the CREWCUT_ADMIN_EMAILS list,
 * the same people who manage the catalog.
 *
 * This hides pages; it doesn't lock anything. The actions behind them still
 * answer org owners and admins, and every signup owns a personal org, so a
 * user calling them directly sees only their own org's settings, the database
 * host name, and which deploy variables are set (never their values).
 */
const OPERATOR_ONLY_PAGE_IDS: ReadonlySet<string> = new Set([
  "infra",
  "audit",
  "apps",
  "auth",
  "sub-agents",
  "skills",
  "files",
  "memory",
  "labs",
  "mcp",
  "channels",
]);

let operator = false;

/** Re-register the pages so the shell re-reads `visible` with the current answer. */
function publish(): void {
  registerSettingsPages(
    CORE_SETTINGS_PAGES.filter((page) => OPERATOR_ONLY_PAGE_IDS.has(page.id)).map((page) => ({
      ...page,
      visible: (context, bridge) => operator && (page.visible ? page.visible(context, bridge) : true),
    })),
  );
}

// Hidden from the first render; the pages appear once the server says the viewer is an operator.
publish();

/** Shows the operator-only Settings pages to Crewcut admins and keeps them hidden from everyone else. */
export function useOperatorOnlySettingsPages(): void {
  const admin = useCatalogAccess()?.admin === true;
  useEffect(() => {
    if (operator === admin) return;
    operator = admin;
    publish();
  }, [admin]);
}
