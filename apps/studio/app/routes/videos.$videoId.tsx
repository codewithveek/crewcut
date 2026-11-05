import { useParams } from "react-router";

import { BoardPage } from "@/components/crewcut/board/board-page";

export function meta() {
  return [{ title: "Pipeline — Crewcut" }];
}

export default function VideoBoardRoute() {
  const { videoId } = useParams();
  if (!videoId) return null;
  return <BoardPage key={videoId} videoId={videoId} />;
}
