import { useCallback, useState } from "react";
import {
  READY_STATUS,
  type LabStatus,
  type StatusSource,
} from "./labTypes";

export function useLabStatus() {
  const [searchStatus, setSearchStatus] = useState<LabStatus>(READY_STATUS);
  const [insightsStatus, setInsightsStatus] = useState<LabStatus>(READY_STATUS);

  const reportStatus = useCallback((source: StatusSource, next: LabStatus) => {
    if (source === "search") setSearchStatus(next);
    else setInsightsStatus(next);
  }, []);

  return { searchStatus, insightsStatus, reportStatus };
}
