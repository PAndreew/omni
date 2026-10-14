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
    const load = () => fetch('/api/weather')
      .then((response) => response.json())
      .then((data) => {
        if (data?.error || !Array.isArray(data?.forecast)) throw new Error('Unavailable');
        setWeather(data);
        setError(false);
      })
      .catch(() => setError(true));

    load();
    const timer = setInterval(load, 10 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  if (error) return <Card className="tile weather-state">Weather unavailable</Card>;
  if (!weather) return <Card className="tile weather-state">Loading weather…</Card>;

  return (
    <Card className={`tile weather-tile ${focused ? 'focused' : ''}`}>
      <p className="title">{weather.city} · Weather</p>
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
