import { useCallback, useMemo, useState } from "react";
import {
  pickStatus,
  READY_STATUS,
  type LabStatus,
  type StatusSource,
} from "./labTypes";

export function useLabStatus() {
  const [navStatus, setNavStatus] = useState<LabStatus>(READY_STATUS);
  const [searchStatus, setSearchStatus] = useState<LabStatus>(READY_STATUS);
  const [insightsStatus, setInsightsStatus] = useState<LabStatus>(READY_STATUS);

  const reportStatus = useCallback((source: StatusSource, next: LabStatus) => {
    if (source === "nav") setNavStatus(next);
    else if (source === "search") setSearchStatus(next);
    else setInsightsStatus(next);
  }, []);

  const status = useMemo(
    () => pickStatus([navStatus, searchStatus, insightsStatus]),
    [navStatus, searchStatus, insightsStatus],
  );

  return { status, insightsStatus, reportStatus };
}
