import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { AccountSettingsCard, useAgentSettingsTabs } from "@agent-native/toolkit/app/settings";

import { CrewcutSettings } from "@/components/crewcut/settings/settings-page";

import { useOperatorOnlySettingsPages } from "@/components/crewcut/settings-visibility";
import { APP_TITLE } from "@/lib/app-config";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: `Settings - ${APP_TITLE}` }];
}

// Crewcut's own settings layout; the pages inside still come from (and save through) the framework.
export default function SettingsRoute() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs({ appName: APP_TITLE, extensionTools: true });
  useSetPageTitle(t("settings.title"));
  useOperatorOnlySettingsPages();

  return (
    <CrewcutSettings
      account={<AccountSettingsCard />}
      extraTabs={agentSettingsTabs}
      whatsNewMarkdown={changelog}
    />
  );
}
