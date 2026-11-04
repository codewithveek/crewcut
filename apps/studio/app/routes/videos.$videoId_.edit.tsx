import { useParams } from "react-router";

import { EditorPage } from "@/components/proofcut/editor/editor-page";

export function meta() {
  return [{ title: "Editor — Proofcut" }];
}

export default function VideoEditorRoute() {
  const { videoId } = useParams();
  if (!videoId) return null;
  return <EditorPage key={videoId} videoId={videoId} />;
}
