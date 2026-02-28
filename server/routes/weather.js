import { Router } from 'express';
import db from '../db.js';

const router = Router();

// Full WMO code mapping for Open-Meteo
const WMO_CODES = {
  0:  { label: 'Clear Sky', icon: '☀️' },
  1:  { label: 'Mainly Clear', icon: '🌤️' },
  2:  { label: 'Partly Cloudy', icon: '⛅' },
  3:  { label: 'Overcast', icon: '☁️' },
  45: { label: 'Foggy', icon: '🌫️' },
  48: { label: 'Icy Fog', icon: '🌫️' },
  51: { label: 'Light Drizzle', icon: '🌦️' },
  53: { label: 'Drizzle', icon: '🌦️' },
  55: { label: 'Heavy Drizzle', icon: '🌧️' },
  56: { label: 'Light Freezing Drizzle', icon: '🌧️' },
  57: { label: 'Freezing Drizzle', icon: '🌧️' },
  61: { label: 'Light Rain', icon: '🌧️' },
  63: { label: 'Rain', icon: '🌧️' },
  65: { label: 'Heavy Rain', icon: '⛈️' },
  66: { label: 'Light Freezing Rain', icon: '🌧️' },
  67: { label: 'Freezing Rain', icon: '🌧️' },
  71: { label: 'Light Snow', icon: '🌨️' },
  73: { label: 'Snow', icon: '❄️' },
  75: { label: 'Heavy Snow', icon: '❄️' },
  77: { label: 'Snow Grains', icon: '🌨️' },
  80: { label: 'Rain Showers', icon: '🌦️' },
  81: { label: 'Showers', icon: '🌧️' },
  82: { label: 'Heavy Showers', icon: '⛈️' },
  85: { label: 'Snow Showers', icon: '🌨️' },
  86: { label: 'Heavy Snow Showers', icon: '❄️' },
  95: { label: 'Thunderstorm', icon: '⛈️' },
  96: { label: 'Thunderstorm with Hail', icon: '⛈️' },
  99: { label: 'Hail Storm', icon: '⛈️' },
};

let cache = null;
let cacheTime = 0;

router.get('/', async (req, res) => {
  try {
    const now = Date.now();
    if (cache && now - cacheTime < 10 * 60 * 1000) return res.json(cache);

    const lat  = process.env.WEATHER_LAT  || db.prepare("SELECT value FROM settings WHERE key='weather_lat'").get()?.value  || '47.4979';
    const lon  = process.env.WEATHER_LON  || db.prepare("SELECT value FROM settings WHERE key='weather_lon'").get()?.value  || '19.0402';
    const city = process.env.WEATHER_CITY || db.prepare("SELECT value FROM settings WHERE key='weather_city'").get()?.value || 'Budapest';

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weathercode,windspeed_10m,relativehumidity_2m&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=4`;
    const resp = await fetch(url);
    const data = await resp.json();

    const current = data.current;
    const daily = data.daily;

    const result = {
      city,
      temp: Math.round(current.temperature_2m),
      feels_like: Math.round(current.apparent_temperature),
      humidity: current.relativehumidity_2m,
      wind: Math.round(current.windspeed_10m),
      condition: WMO_CODES[current.weathercode] || { label: 'Unknown', icon: '🌡️' },
      forecast: daily.time.slice(1, 4).map((date, i) => ({
        date,
        high: Math.round(daily.temperature_2m_max[i + 1]),
        low: Math.round(daily.temperature_2m_min[i + 1]),
        condition: WMO_CODES[daily.weathercode[i + 1]] || { label: 'Unknown', icon: '🌡️' },
      })),
    };

    cache = result;
    cacheTime = now;
    res.json(result);
  } catch (err) {
    console.error('Weather error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
