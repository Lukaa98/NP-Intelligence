import React, { useEffect, useRef } from "react";
import { mountMap } from "../map/mapViewer.js";

// Small embedded galaxy map centred on one player: their territory outlined
// in their colour, allies in green, enemies in red, everyone else dimmed.
export default function PlayerMap({ snapshot, relations, uid, onOpenFull }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);

  useEffect(() => {
    if (!snapshot || !containerRef.current) return undefined;
    viewerRef.current = mountMap(containerRef.current, snapshot, { compact: true, relations, showRelations: false });
    viewerRef.current.selectPlayerByUid(uid);
    return () => {
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
    // Relations and uid are applied below without remounting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  useEffect(() => {
    viewerRef.current?.setRelations(relations);
    viewerRef.current?.selectPlayerByUid(uid);
  }, [relations, uid]);

  return (
    <div className="player-map">
      <div className="player-map-host" ref={containerRef} />
      {onOpenFull && <button type="button" className="ghost small open-full" onClick={onOpenFull}>Open full map ↗</button>}
    </div>
  );
}
