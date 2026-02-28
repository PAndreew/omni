import { useState, useEffect } from 'react';

export default function Weather({ focused }) {
  const [weather, setWeather] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/weather')
      .then(r => r.json())
      .then(setWeather)
      .catch(() => setError('Unavailable'));
    const id = setInterval(() => {
      fetch('/api/weather').then(r => r.json()).then(setWeather).catch(() => {});
    }, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  if (error) return (
    <div className={`tile ${focused ? 'focused' : ''}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
      <p>Weather unavailable</p>
    </div>
  );

  if (!weather) return (
    <div className={`tile ${focused ? 'focused' : ''}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="skeleton" style={{ width: 120, height: 80, borderRadius: 12, background: 'var(--surface-2)' }} />
    </div>
  );

  return (
    <div className={`tile weather-tile ${focused ? 'focused' : ''}`}>
      <p className="title">{weather.city} · Weather</p>

      <div className="weather-main">
        <span className="weather-icon">{weather.condition.icon}</span>
        <div>
          <div className="weather-temp">{weather.temp}°</div>
          <div className="weather-label">{weather.condition.label}</div>
          <div className="weather-meta">
            Feels {weather.feels_like}° · {weather.humidity}% humidity · {weather.wind} km/h
          </div>
        </div>
      </div>

      <div className="weather-forecast">
        {weather.forecast.map((day, i) => (
          <div key={i} className="glass forecast-day">
            <div className="forecast-date">{new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })}</div>
            <div className="forecast-icon">{day.condition.icon}</div>
            <div className="forecast-range">
              <span style={{ color: 'var(--text)' }}>{day.high}°</span>
              <span style={{ color: 'var(--text-dim)' }}>{day.low}°</span>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        .weather-tile { display: flex; flex-direction: column; gap: 16px; }
        .weather-main { display: flex; align-items: center; gap: 20px; }
        .weather-icon { font-size: 56px; filter: drop-shadow(0 0 12px rgba(0,212,255,0.3)); }
        .weather-temp { font-size: clamp(36px, 4vw, 56px); font-weight: 300;
                        font-family: 'Roboto Mono', monospace; letter-spacing: -1px; }
        .weather-label { font-size: 14px; color: var(--text-dim); font-weight: 300; text-transform: uppercase; letter-spacing: 0.1em; }
        .weather-meta  { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
        .weather-forecast { display: flex; gap: 8px; }
        .forecast-day { flex: 1; padding: 10px 8px; text-align: center; display: flex; flex-direction: column; gap: 4px; align-items: center; }
        .forecast-date { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-dim); }
        .forecast-icon { font-size: 22px; }
        .forecast-range { display: flex; gap: 6px; font-size: 12px; font-family: 'Roboto Mono', monospace; }
      `}</style>
    </div>
  );
}
