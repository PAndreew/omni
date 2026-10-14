import { useEffect, useState } from 'react';
import { Card } from './ui/card.jsx';
import {
  Sun, CloudSun, Cloud, Cloudy, CloudFog,
  CloudDrizzle, CloudRain, CloudSnow, CloudLightning, CloudHail,
} from 'lucide-react';

const ICON_MAP = {
  sun: Sun,
  'partly-cloudy': CloudSun,
  cloud: Cloudy,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
  hail: CloudHail,
};

function WeatherIcon({ code }) {
  const Icon = ICON_MAP[code] ?? Cloud;
  return <Icon className="forecast-icon" strokeWidth={1.15} aria-hidden="true" />;
}

export default function Weather({ focused }) {
  const [weather, setWeather] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let disposed = false;
    let timer;
    let controller;
    const load = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      let delay = 30_000;
      try {
        const response = await fetch('/api/weather', { signal: controller.signal });
        if (!response.ok) throw new Error('Unavailable');
        const data = await response.json();
        if (data?.error || !Array.isArray(data?.forecast) || data.forecast.length < 2) throw new Error('Unavailable');
        if (!disposed) {
          setWeather(data);
          setError(false);
        }
        delay = 10 * 60 * 1000;
      } catch {
        if (!disposed) setError(true);
      } finally {
        clearTimeout(timeout);
        if (!disposed) timer = setTimeout(load, delay);
      }
    };

    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, []);

  if (error && !weather) return <Card className="tile weather-state" role="status">Weather unavailable · Retrying…</Card>;
  if (!weather) return <Card className="tile weather-state">Loading weather…</Card>;

  return (
    <Card className={`tile weather-tile ${focused ? 'focused' : ''}`}>
      <p className="title">{weather.city} · Weather{error && <span role="status"> · Last forecast · Retrying…</span>}</p>
      <div className="forecast-columns">
        {weather.forecast.slice(0, 2).map((day, index) => (
          <article key={day.date} className={`forecast-card ${index === 0 ? 'today' : ''}`}>
            <p className="forecast-day-name">
              {index === 0 ? 'Today' : 'Tomorrow'}
            </p>
            <WeatherIcon code={day.condition?.icon} />
            <p className="forecast-temperature">{day.current ?? day.high}°</p>
            <p className="forecast-condition">{day.condition?.label}</p>
            <p className="forecast-high-low"><strong>{day.high}°</strong><span>{day.low}°</span></p>
          </article>
        ))}
      </div>
    </Card>
  );
}
