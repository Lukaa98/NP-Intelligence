import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { mountMap } from "../map/mapViewer.js";

// Scans are large, so each one is fetched once per page load.
const snapshotCache = new Map();
function loadSnapshot(id) {
  if (!snapshotCache.has(id)) snapshotCache.set(id, api.snapshot(id));
  return snapshotCache.get(id);
}

// Small map for one alert: everything dimmed except the attacking fleet and
// the threatened star, with an arrow and label between them.
export default function ThreatMap({ threat, label }) {
  const containerRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!threat.snapshotId) {
      setError("No scan stored for this alert.");
      return undefined;
    }
    let viewer = null;
    let cancelled = false;
    loadSnapshot(threat.snapshotId)
      .then((snapshot) => {
        if (cancelled || !containerRef.current) return;
        viewer = mountMap(containerRef.current, snapshot, { compact: true, showRelations: false });
        viewer.focusThreat(threat.targetUid, threat.fleetUid, label);
      })
      .catch((loadError) => !cancelled && setError(loadError.message));
    return () => {
      cancelled = true;
      viewer?.destroy();
    };
  }, [threat.snapshotId, threat.targetUid, threat.fleetUid, label]);

  if (error) return <p className="error small">{error}</p>;
  return <div className="threat-map" ref={containerRef} />;
}
