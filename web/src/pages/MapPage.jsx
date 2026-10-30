import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { mountMap } from "../map/mapViewer.js";
import { downloadStandaloneHtml } from "../map/exportHtml.js";
import { formatBytes, formatDateTime, notesForExport } from "../format.js";
import PlayerRating from "../components/PlayerRating.jsx";

const PLAY_INTERVAL_MS = 1200;

export default function MapPage({ snapshotId, notes }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const cache = useRef(new Map());
  // `snapshot` mounts the viewer; `frame` is whatever tick the timeline shows.
  const [snapshot, setSnapshot] = useState(null);
  const [frame, setFrame] = useState(null);
  const [frames, setFrames] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [loadingFrame, setLoadingFrame] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [pinned, setPinned] = useState(false);
  const [relations, setRelations] = useState([]);

  const viewerNotes = useMemo(() => notesForExport(notes), [notes.list]);
  const current = frame || snapshot;
  const index = frames.findIndex((item) => item.id === current?.id);

  useEffect(() => {
    let cancelled = false;
    api.snapshot(snapshotId)
      .then((loaded) => {
        if (cancelled) return;
        cache.current.set(loaded.id, loaded);
        setSnapshot(loaded);
        setPinned(loaded.pinned);
        // Alliance lines and the timeline are extras; the map works without them.
        api.diplomacy(loaded.gameNumber)
          .then((diplomacy) => !cancelled && setRelations(diplomacy.pairs || []))
          .catch(() => {});
        // Live scans come from the backend; a finished game's history comes
        // from the git archive once Cloudflare has dropped it.
        Promise.all([
          api.snapshots(loaded.gameNumber, { limit: 5000 }).catch(() => []),
          api.archivedGame(loaded.gameNumber)
        ]).then(([list, archived]) => {
          if (cancelled) return;
          const fromArchive = (archived?.frames || []).map((item) => ({ ...item, gameNumber: loaded.gameNumber, archived: true }));
          setFrames(timelineFrames([...fromArchive, ...list]));
        });
      })
      .catch((loadError) => !cancelled && setError(loadError.message));
    return () => {
      cancelled = true;
    };
  }, [snapshotId]);

  useEffect(() => {
    if (!snapshot || !containerRef.current) return undefined;
    viewerRef.current = mountMap(containerRef.current, snapshot, {
      notes: viewerNotes,
      onPlayerSelect: (player) => setSelected(player ? { alias: player.alias } : null)
    });
    return () => {
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
    // Notes and relations are pushed separately so they don't reset pan/zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  useEffect(() => {
    viewerRef.current?.setNotes(viewerNotes);
  }, [viewerNotes]);

  useEffect(() => {
    viewerRef.current?.setRelations(relations);
  }, [relations, snapshot]);

  const fetchFrame = useCallback(async (meta) => {
    if (!cache.current.has(meta.id)) {
      const loaded = meta.archived
        ? { ...(await api.archivedFrame(meta.gameNumber, meta.file)), archived: true }
        : await api.snapshot(meta.id);
      cache.current.set(meta.id, loaded);
    }
    return cache.current.get(meta.id);
  }, []);

  const showFrame = useCallback(async (nextIndex) => {
    const meta = frames[nextIndex];
    if (!meta) return false;
    setLoadingFrame(true);
    try {
      const loaded = await fetchFrame(meta);
      viewerRef.current?.setSnapshot(loaded);
      setFrame(loaded);
      setPinned(loaded.pinned);
      // Warm the next frame so playback doesn't stall on the network.
      if (frames[nextIndex + 1]) fetchFrame(frames[nextIndex + 1]).catch(() => {});
      return true;
    } catch (frameError) {
      setError(frameError.message);
      return false;
    } finally {
      setLoadingFrame(false);
    }
  }, [fetchFrame, frames]);

  useEffect(() => {
    if (!playing) return undefined;
    if (index >= frames.length - 1) {
      setPlaying(false);
      return undefined;
    }
    const timer = setTimeout(() => showFrame(index + 1), PLAY_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [playing, index, frames.length, showFrame]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.target.closest?.("input, textarea")) return;
      if (event.key === "ArrowLeft" && index > 0) showFrame(index - 1);
      if (event.key === "ArrowRight" && index < frames.length - 1) showFrame(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, frames.length, showFrame]);

  if (error) {
    return <div className="card map-error"><p className="error">{error}</p><a href="#/">Back to games</a></div>;
  }

  return (
    <div className="map-page">
      <div className="map-bar">
        <a href={current ? `#/game/${current.gameNumber}` : "#/"} className="ghost-link">← {current?.gameName || "Back"}</a>
        <span className="muted small">
          {current ? `Tick ${current.tick} · ${formatDateTime(current.capturedAt)}${current.label ? ` · ${current.label}` : ""}` : "Loading snapshot…"}
        </span>
        {selected && current && (
          <div className="map-rating">
            <strong>{selected.alias}</strong>
            <PlayerRating alias={selected.alias} notes={notes} game={{ gameNumber: current.gameNumber, gameName: current.gameName }} compact />
          </div>
        )}
        <div className="actions">
          {current && !current.archived && (
            <button type="button" className="ghost" onClick={async () => {
              try {
                if (pinned) {
                  await api.unpinSnapshot(current.id);
                } else {
                  await api.pinSnapshot(current.id, "Manual capture");
                }
                setPinned(!pinned);
              } catch (pinError) {
                setError(pinError.message);
              }
            }}>{pinned ? "★ Pinned" : "☆ Pin as capture"}</button>
          )}
          {current && (
            <button type="button" className="primary" onClick={() => downloadStandaloneHtml(current, viewerNotes, relations)}>Download HTML</button>
          )}
        </div>
      </div>

      {frames.length > 1 && (
        <div className="timeline">
          <button type="button" className="ghost" disabled={index <= 0} onClick={() => showFrame(index - 1)} title="Previous tick (←)">◀</button>
          <button
            type="button"
            className="primary play"
            onClick={() => {
              if (!playing && index >= frames.length - 1) showFrame(0);
              setPlaying(!playing);
            }}
          >{playing ? "❚❚ Pause" : "▶ Play"}</button>
          <button type="button" className="ghost" disabled={index >= frames.length - 1} onClick={() => showFrame(index + 1)} title="Next tick (→)">▶</button>
          <input
            type="range"
            min={0}
            max={frames.length - 1}
            value={Math.max(index, 0)}
            onChange={(event) => {
              setPlaying(false);
              showFrame(Number(event.target.value));
            }}
            aria-label="Timeline"
          />
          <span className="timeline-label">
            tick {current?.tick ?? "?"} <span className="muted">({Math.max(index, 0) + 1}/{frames.length})</span>
            {loadingFrame && <span className="muted"> · loading…</span>}
          </span>
          <span className="muted small timeline-hint">Yellow rings = stars that changed owner since the previous frame · ~{formatBytes(frames[Math.max(index, 0)]?.sizeBytes)} per frame</span>
        </div>
      )}

      <div className="map-host" ref={containerRef} />
    </div>
  );
}

// One frame per tick, oldest first. When several scans share a tick (a
// capture right after a scheduled scan), keep the newest; prefer the live
// backend copy over the archived one.
function timelineFrames(list) {
  const byTick = new Map();
  for (const item of list) {
    const existing = byTick.get(item.tick);
    const better = !existing
      || (existing.archived && !item.archived)
      || (existing.archived === item.archived && item.capturedAt > existing.capturedAt);
    if (better) byTick.set(item.tick, item);
  }
  return [...byTick.values()].sort((x, y) => x.tick - y.tick);
}
