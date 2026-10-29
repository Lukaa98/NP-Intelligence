import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { mountMap } from "../map/mapViewer.js";
import { downloadStandaloneHtml } from "../map/exportHtml.js";
import { formatDateTime, notesForExport } from "../format.js";
import PlayerRating from "../components/PlayerRating.jsx";

export default function MapPage({ snapshotId, notes }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [pinned, setPinned] = useState(false);

  const viewerNotes = useMemo(() => notesForExport(notes), [notes.list]);

  useEffect(() => {
    let cancelled = false;
    api.snapshot(snapshotId)
      .then((loaded) => {
        if (cancelled) return;
        setSnapshot(loaded);
        setPinned(loaded.pinned);
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
    // Notes are pushed separately below so a rating doesn't reset pan/zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  useEffect(() => {
    viewerRef.current?.setNotes(viewerNotes);
  }, [viewerNotes]);

  if (error) {
    return <div className="card map-error"><p className="error">{error}</p><a href="#/">Back to games</a></div>;
  }

  return (
    <div className="map-page">
      <div className="map-bar">
        <a href={snapshot ? `#/game/${snapshot.gameNumber}` : "#/"} className="ghost-link">← {snapshot?.gameName || "Back"}</a>
        <span className="muted small">
          {snapshot ? `Tick ${snapshot.tick} · ${formatDateTime(snapshot.capturedAt)}${snapshot.label ? ` · ${snapshot.label}` : ""}` : "Loading snapshot…"}
        </span>
        {selected && snapshot && (
          <div className="map-rating">
            <strong>{selected.alias}</strong>
            <PlayerRating alias={selected.alias} notes={notes} game={{ gameNumber: snapshot.gameNumber, gameName: snapshot.gameName }} compact />
          </div>
        )}
        <div className="actions">
          {snapshot && (
            <button type="button" className="ghost" onClick={async () => {
              try {
                if (pinned) {
                  await api.unpinSnapshot(snapshot.id);
                } else {
                  await api.pinSnapshot(snapshot.id, "Manual capture");
                }
                setPinned(!pinned);
              } catch (pinError) {
                setError(pinError.message);
              }
            }}>{pinned ? "★ Pinned" : "☆ Pin as capture"}</button>
          )}
          {snapshot && (
            <button type="button" className="primary" onClick={() => downloadStandaloneHtml(snapshot, viewerNotes)}>Download HTML</button>
          )}
        </div>
      </div>
      <div className="map-host" ref={containerRef} />
    </div>
  );
}
