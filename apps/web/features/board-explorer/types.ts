import type { BoardRegion, RegionStatus } from "@/lib/regions";

export interface BoardExplorerProps {
  regions: BoardRegion[];
  /** per region id; default "unvisited" */
  statuses: Record<string, RegionStatus>;
  /** highlighted region */
  selectedId: string | null;
  /** when non-null the camera flies to frame this region; null = overview */
  focusId: string | null;
  /** click on region (or empty board/background -> null) */
  onSelect: (id: string | null) => void;
  /** fired once the camera transition completes (or immediately with reduced motion) */
  onFocusSettled?: (id: string | null) => void;
  /** if true, no animated camera flights (jump cuts) and no idle motion */
  reducedMotion?: boolean;
  /** sizing comes from the parent (fills parent box: width/height 100%) */
  className?: string;
}
