import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Clock from './components/Clock.jsx';
import Weather from './components/Weather.jsx';
import ChoreList from './components/ChoreList.jsx';
import RssWidget from './components/RssWidget.jsx';
import CalendarWidget from './components/CalendarWidget.jsx';

const SLIDES = [
  { id: 'time', label: 'Time', component: Clock },
  { id: 'weather', label: 'Weather', component: Weather },
  { id: 'todos', label: 'Todos', component: ChoreList },
  { id: 'news', label: 'News', component: RssWidget },
  { id: 'calendar', label: 'Calendar', component: CalendarWidget },
];

const AUTOPLAY_MS = 30_000;
const SWIPE_THRESHOLD = 55;

export default function App() {
  const [active, setActive] = useState(() => {
    const requestedSlide = new URLSearchParams(window.location.search).get('slide');
    const requestedIndex = SLIDES.findIndex((slide) => slide.id === requestedSlide);
    return requestedIndex >= 0 ? requestedIndex : 0;
  });
  const [paused, setPaused] = useState(false);
  const pointerStart = useRef(null);
  const pauseTimer = useRef(null);

  const show = useCallback((index) => {
    setActive((index + SLIDES.length) % SLIDES.length);
  }, []);

  const pauseAutoplay = useCallback(() => {
    setPaused(true);
    clearTimeout(pauseTimer.current);
    pauseTimer.current = setTimeout(() => setPaused(false), AUTOPLAY_MS);
  }, []);

  const navigate = useCallback((index) => {
    show(index);
    pauseAutoplay();
  }, [pauseAutoplay, show]);

  useEffect(() => {
    if (paused) return undefined;
    const timer = setInterval(() => setActive((current) => (current + 1) % SLIDES.length), AUTOPLAY_MS);
    return () => clearInterval(timer);
  }, [paused]);

  useEffect(() => () => clearTimeout(pauseTimer.current), []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'ArrowRight') navigate(active + 1);
      if (event.key === 'ArrowLeft') navigate(active - 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, navigate]);

  const onPointerDown = (event) => {
    pointerStart.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerUp = (event) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
    navigate(active + (dx < 0 ? 1 : -1));
  };

  return (
    <main className="carousel-shell" aria-label="OmniWall dashboard">
      <div
        className="carousel-viewport"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { pointerStart.current = null; }}
      >
        <div
          className="carousel-track"
          style={{
            '--slide-count': SLIDES.length,
            width: `${SLIDES.length * 100}%`,
            transform: `translate3d(-${active * (100 / SLIDES.length)}%, 0, 0)`,
          }}
        >
          {SLIDES.map(({ id, label, component: Component }, index) => (
            <section
              key={id}
              className={`carousel-slide carousel-slide--${id}`}
              aria-label={label}
              aria-hidden={index !== active}
            >
              <Component focused={index === active} />
            </section>
          ))}
        </div>
      </div>

      <header className="carousel-header">
        <span className="carousel-brand">OmniWall</span>
        <span className="carousel-section">{SLIDES[active].label}</span>
      </header>

      <button className="carousel-arrow carousel-arrow--left" onClick={() => navigate(active - 1)} aria-label="Previous screen">
        <ChevronLeft size={34} strokeWidth={1.5} />
      </button>
      <button className="carousel-arrow carousel-arrow--right" onClick={() => navigate(active + 1)} aria-label="Next screen">
        <ChevronRight size={34} strokeWidth={1.5} />
      </button>

      <nav className="carousel-dots" aria-label="Dashboard screens">
        {SLIDES.map((slide, index) => (
          <button
            key={slide.id}
            className={`carousel-dot ${index === active ? 'active' : ''}`}
            onClick={() => navigate(index)}
            aria-label={`Show ${slide.label}`}
            aria-current={index === active ? 'page' : undefined}
          />
        ))}
      </nav>
    </main>
  );
}
