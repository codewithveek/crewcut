import { useParams } from "react-router";

import { EditorPage } from "@/components/crewcut/editor/editor-page";

export function meta() {
  return [{ title: "Editor — Crewcut" }];
}

export default function VideoEditorRoute() {
  const { videoId } = useParams();
  if (!videoId) return null;
  return <EditorPage key={videoId} videoId={videoId} />;
}
