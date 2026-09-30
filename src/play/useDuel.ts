import type { OcgCoreSync, OcgResponse } from "ocgcore-wasm";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { EngineData } from "../engine/data";
import { activateAt, loadCore, settle, startDuel, undoResponses } from "../engine/run";
import type { DuelSession, DuelSetup, Hit } from "../engine/session";

/** 管理当前对局：开局、回应、撤销、回到吃坑点让对手发动。session 在原地变化，用计数器触发重绘。 */
export function useDuel(data: EngineData | null) {
  const core = useRef<OcgCoreSync | null>(null);
  const [session, setSession] = useState<DuelSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, bump] = useReducer((x: number) => x + 1, 0);

  useEffect(() => () => session?.destroy(), [session]);

  const run = useCallback(
    async (setup: DuelSetup, responses: OcgResponse[] = []) => {
      if (!data) return;
      setBusy(true);
      setError(null);
      try {
        core.current ??= await loadCore();
        const s = await startDuel(core.current, data, setup, responses);
        setSession(s);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [data],
  );

  const respond = useCallback(
    async (r: OcgResponse) => {
      if (!session || !data || !core.current) return;
      session.respond(r);
      if (session.status === "missing_scripts") {
        setBusy(true);
        const s = await settle(core.current, data, session);
        setBusy(false);
        setSession(s);
      } else bump();
    },
    [session, data],
  );

  const undo = useCallback(() => {
    if (!session) return;
    const r = undoResponses(session);
    if (r) void run(session.setup, r);
  }, [session, run]);

  const activate = useCallback(
    (hit: Hit, index: number) => {
      if (session) void run(session.setup, activateAt(session, hit, index));
    },
    [session, run],
  );

  return { session, busy, error, version, run, respond, undo, activate };
}
