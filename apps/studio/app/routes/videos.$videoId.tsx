import { useParams } from "react-router";

import { BoardPage } from "@/components/proofcut/board/board-page";

export function meta() {
  return [{ title: "Pipeline — Proofcut" }];
}

export default function VideoBoardRoute() {
  const { videoId } = useParams();
  if (!videoId) return null;
  return <BoardPage key={videoId} videoId={videoId} />;
}
