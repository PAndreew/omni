import ControlPanel from './components/ControlPanel.jsx';
import Clock from './components/Clock.jsx';
import Weather from './components/Weather.jsx';
import CalendarWidget from './components/CalendarWidget.jsx';
import GiziButton from './components/GiziButton.jsx';
import MusicAliases from './components/MusicAliases.jsx';

export default function App() {
  if (location.pathname === '/gizi/aliases') return <MusicAliases />;
  return (
    <main className="dashboard" aria-label="Beezywall dashboard">
      <section className="dashboard-clock" aria-label="Current time"><Clock /></section>
      <section className="dashboard-weather" aria-label="Weather today and tomorrow"><Weather /></section>
      <section className="dashboard-calendar" aria-label="Calendar"><CalendarWidget /></section>
      <section className="dashboard-controls" aria-label="Control panel"><ControlPanel /></section>
      <nav className="dashboard-nav" aria-label="Beezywall navigation">
        <img className="dashboard-logo" src="/beezee-logo.svg" alt="Beezee" />
        <GiziButton />
      </nav>
    </main>
  );
}
