import { HomePage } from "@/components/proofcut/home-page";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [
    { title: `${APP_TITLE} — agent-native video studio` },
    { name: "description", content: "Agents research, script, fact-check, animate, voice and publish your videos. You approve every stage; every claim links to its source." },
  ];
}

export default function HomeRoute() {
  return <HomePage />;
}
