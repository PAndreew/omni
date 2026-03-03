export default function ClaudeIcon({ size = 22, className = '', style = {} }) {
  return (
    <img
      src="/claude.svg"
      alt="Claude"
      className={className}
      style={{ width: size, height: size, display: 'block', ...style }}
    />
  );
}
