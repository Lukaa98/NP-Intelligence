import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { analyseActivity, formatHour, formatOffset } from "../activityHistory.js";

const dayLabel = (ms) => new Date(ms).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
const dateTime = (ms) => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric" });

// Past activity of one player: a day strip, AFK spells and when they play,
// with a guess at their timezone. Times are shown in the viewer's local time.
export default function ActivityHistory({ gameNumber, uid }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setResult(null);
    api.playerActivity(gameNumber, uid)
      .then((history) => setResult(analyseActivity(history)))
      .catch((loadError) => setError(loadError.message));
  }, [gameNumber, uid]);

  if (error) return <p className="error small">{error}</p>;
  if (!result) return <p className="muted small">Loading history…</p>;
  if (!result.trackedSince) return <p className="muted small">No history recorded yet.</p>;

  const maxHour = Math.max(1, ...result.hours);
  const myOffset = -new Date().getTimezoneOffset() / 60;

  return (
    <div className="activity-history">
      <div className="history-block">
        <div className="muted small">Last {result.days.length} days (green = did something, grey = nothing, dark = before tracking)</div>
        <div className="day-strip">
          {result.days.map((day) => (
            <span
              key={day.from}
              className={`day ${!day.tracked ? "untracked" : day.active ? "on" : "off"}`}
              title={`${dayLabel(day.from)}: ${!day.tracked ? "not tracked yet" : day.active
                ? [day.infra && `${day.infra} infra`, day.carriers && `${day.carriers} carriers`, day.orders && `${day.orders} fleet orders`, day.captures && `${day.captures} captures`].filter(Boolean).join(", ")
                : "no manual actions"}`}
            />
          ))}
        </div>
        <div className="day-strip-labels muted small">
          <span>{dayLabel(result.days[0].from)}</span>
          <span>today</span>
        </div>
      </div>

      <div className="history-block">
        <div className="small"><strong>AFK spells</strong> <span className="muted">(a day or more without a manual action)</span></div>
        {!result.spells.length ? <p className="muted small">None since tracking started {dateTime(result.trackedSince)}.</p> : (
          <ul className="spell-list small">
            {result.spells.map((spell) => (
              <li key={spell.from}>
                {spell.ongoing ? "Inactive since " : spell.beforeFirst ? "Inactive from tracking start " : "Inactive "}
                {dateTime(spell.from)}{spell.ongoing ? "" : ` → ${dateTime(spell.to)}`}
                <span className="muted"> ({spell.hours >= 48 ? `${Math.round(spell.hours / 24)} days` : `${spell.hours}h`}{spell.ongoing ? " so far" : ""})</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="history-block">
        <div className="small"><strong>When they play</strong> <span className="muted">(your local time, {result.moments} active hours recorded)</span></div>
        <div className="hour-bars" aria-label="Actions by hour of day">
          {result.hours.map((count, hour) => (
            <span key={hour} className="hour-bar" title={`${formatHour(hour)}: ${count}`}>
              <span style={{ height: `${(count / maxHour) * 100}%` }} />
            </span>
          ))}
        </div>
        <div className="hour-labels muted small"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span></div>
        {result.busiest && (
          <p className="small">
            Most active <strong>{formatHour(result.busiest.start)}–{formatHour(result.busiest.end)}</strong> your time
            {" "}({Math.round(result.busiest.share * 100)}% of their actions).
          </p>
        )}
        {result.timezone ? (
          <p className="small">
            Likely timezone: <strong>{formatOffset(result.timezone.offset)}</strong>
            {result.timezone.region && ` (${result.timezone.region})`}
            {result.timezone.range[0] !== result.timezone.range[1] && <span className="muted"> · fits {formatOffset(result.timezone.range[0])} to {formatOffset(result.timezone.range[1])}</span>}
            <span className="muted"> · {result.timezone.confidence}{result.timezone.offset === Math.round(myOffset) ? " · same as you" : ""}</span>
          </p>
        ) : <p className="muted small">Not enough actions yet to guess a timezone (needs 5+ active hours).</p>}
      </div>
    </div>
  );
}
