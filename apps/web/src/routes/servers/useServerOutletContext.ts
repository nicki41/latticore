import { useOutletContext } from "react-router-dom";
import type { ServerDto } from "@latticore/shared";

export function useServerOutletContext() {
  return useOutletContext<{ server: ServerDto }>();
}
