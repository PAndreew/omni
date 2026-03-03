export default function PiIcon({ size = 22, className = '', style = {} }) {
  return (
    <img
      src="/logo.svg"
      alt="Pi"
      className={className}
      style={{ width: size, height: size, display: 'block', ...style }}
    />
  );
}
