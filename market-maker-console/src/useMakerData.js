import { useCallback, useEffect, useRef, useState } from "react";
import { newerSnapshot } from "./makerDataUtils.js";

const DEFAULT_API_BASE = import.meta.env.PROD ? window.location.origin : "http://127.0.0.1:8788";
const API_BASE = (import.meta.env.VITE_MAKER_API_URL ?? DEFAULT_API_BASE).replace(/\/$/, "");

export function useMakerData() {
  const [state, setState] = useState({ status: "connecting", health: null, config: null, snapshot: null, volume: null, accounting: null, tokenIntelligence: null, tokenMonitor: null, executionInfrastructure: null, staking: null, audit: [], intents: [], error: null, stream: "connecting", streamFailures: 0, updatedAt: null });
  const eventSourceRef = useRef(null);
  const mountedRef = useRef(true);
  const streamFailuresRef = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const [healthResponse, configResponse, snapshotResponse, volumeResponse, accountingResponse, intelligenceResponse, monitorResponse, infrastructureResponse, stakingResponse, auditResponse, intentsResponse] = await Promise.all([
        fetch(`${API_BASE}/api/health`, { cache: "no-store" }),
        fetch(`${API_BASE}/api/v1/config`, { cache: "no-store" }),
        fetch(`${API_BASE}/api/v1/snapshot`, { cache: "no-store" }),
        fetch(`${API_BASE}/api/v1/volume?days=7`, { cache: "no-store" }),
        fetch(`${API_BASE}/api/v1/accounting`, { cache: "no-store" }),
        fetch(`${API_BASE}/api/public/v1/token-intelligence`, { cache: "no-store" }),
        fetch(`${API_BASE}/api/public/v1/token-monitor`, { cache: "no-store" }),
        fetch(`${API_BASE}/api/public/v1/execution-infrastructure`, { cache: "no-store" }),
        fetch(`${API_BASE}/api/public/v1/staking`, { cache: "no-store" }),
        fetch(`${API_BASE}/api/v1/audit?limit=100`, { cache: "no-store" }),
        fetch(`${API_BASE}/api/v1/intents?limit=100`, { cache: "no-store" }),
      ]);
      const coreResponses = [healthResponse, configResponse, snapshotResponse];
      if (coreResponses.some((response) => !response.ok)) throw new Error(`核心监控 API ${coreResponses.map((response) => response.status).join("/")}`);
      const optionalResponses = [volumeResponse, accountingResponse, intelligenceResponse, monitorResponse, infrastructureResponse, stakingResponse, auditResponse, intentsResponse];
      const optionalFailures = optionalResponses.filter((response) => !response.ok).map((response) => response.status);
      const [health, config, snapshot, volume, accounting, tokenIntelligence, tokenMonitor, executionInfrastructure, staking, audit, intents] = await Promise.all([
        healthResponse.json(),
        configResponse.json(),
        snapshotResponse.json(),
        volumeResponse.ok ? volumeResponse.json() : null,
        accountingResponse.ok ? accountingResponse.json() : null,
        intelligenceResponse.ok ? intelligenceResponse.json() : null,
        monitorResponse.ok ? monitorResponse.json() : null,
        infrastructureResponse.ok ? infrastructureResponse.json() : null,
        stakingResponse.ok ? stakingResponse.json() : null,
        auditResponse.ok ? auditResponse.json() : null,
        intentsResponse.ok ? intentsResponse.json() : null,
      ]);
      if (!mountedRef.current) return;
      setState((current) => ({
        ...current,
        status: health.status === "ready" ? "live" : "degraded",
        health,
        config,
        snapshot: newerSnapshot(current.snapshot, snapshot),
        volume: volume ?? current.volume,
        accounting: accounting ?? current.accounting,
        tokenIntelligence: tokenIntelligence ?? current.tokenIntelligence,
        tokenMonitor: tokenMonitor ?? current.tokenMonitor,
        executionInfrastructure: executionInfrastructure ?? current.executionInfrastructure,
        staking: staking ?? current.staking,
        audit: audit?.events ?? current.audit,
        intents: intents?.intents ?? current.intents,
        error: optionalFailures.length ? `部分辅助 API 暂时不可用（${optionalFailures.join("/")}），核心监控仍在运行。` : null,
        updatedAt: new Date().toISOString(),
      }));
    } catch (error) {
      if (mountedRef.current) setState((current) => ({ ...current, status: "offline", error: error.message, updatedAt: new Date().toISOString() }));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    try {
      const events = new EventSource(`${API_BASE}/api/v1/events`);
      eventSourceRef.current = events;
      events.onopen = () => {
        streamFailuresRef.current = 0;
        setState((current) => ({ ...current, stream: "connected", streamFailures: 0 }));
      };
      events.addEventListener("snapshot", (event) => {
        const snapshot = JSON.parse(event.data);
        setState((current) => ({ ...current, snapshot: newerSnapshot(current.snapshot, snapshot), stream: "connected", error: null, updatedAt: new Date().toISOString() }));
      });
      events.onerror = () => {
        streamFailuresRef.current += 1;
        setState((current) => ({
          ...current,
          stream: streamFailuresRef.current >= 3 ? "degraded" : "reconnecting",
          streamFailures: streamFailuresRef.current,
          error: streamFailuresRef.current >= 3 ? "实时事件流连续断开，轮询仍在继续。" : current.error,
        }));
      };
    } catch {
      // Polling remains active when EventSource is unavailable.
    }
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      eventSourceRef.current?.close();
    };
  }, [refresh]);

  return { ...state, apiBase: API_BASE, refresh };
}
