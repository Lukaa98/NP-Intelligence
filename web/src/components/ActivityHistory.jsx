import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { analyseActivity, formatHour, formatOffset } from "../activityHistory.js";

function ago(ms) {
  const hours = Math.max(0, Math.round((Date.now() - ms) / 3600000));
  if (hours < 1) return "within the hour";
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function describeMoment(moment) {
  const parts = [];
  if (moment.infra) parts.push(`bought ${moment.infra} infra`);
  if (moment.carriers) parts.push(`built ${moment.carriers} carrier${moment.carriers === 1 ? "" : "s"}`);
  if (moment.orders) parts.push(`${moment.orders} new fleet order${moment.orders === 1 ? "" : "s"}`);
  if (moment.captures) parts.push(`took ${moment.captures} star${moment.captures === 1 ? "" : "s"}`);
  return parts.join(", ") || "activity";
}

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
        <div className="small"><strong>Recent actions</strong></div>
        {!result.recent.length ? <p className="muted small">No manual actions recorded yet.</p> : (
          <ul className="spell-list small">
            {result.recent.map((moment) => (
              <li key={moment.tick}>
                <strong>{ago(moment.time)}</strong>
                <span className="muted"> ({dateTime(moment.time)})</span>: {describeMoment(moment)}
              </li>
            ))}
          </ul>
        )}
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
            Plays mostly <strong>{formatHour(result.busiest.start)}–{formatHour(result.busiest.end)}</strong> your time
            {" "}({Math.round(result.busiest.share * 100)}% of their actions).
          </p>
        )}
        {result.timezone && (
          <p className="muted small">
            Very rough timezone guess: around {formatOffset(result.timezone.offset)}
            {result.timezone.region && ` (${result.timezone.region})`} ±2h. People play at all hours, so take it lightly.
          </p>
        )}
      </div>
    </div>
  );
}
