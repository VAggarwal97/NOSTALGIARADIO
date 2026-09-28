const GITHUB = 'https://github.com/VAggarwal97/NOSTALGIARADIO';

interface SiteFooterProps {
  onOpenSearch: () => void;
}

export function SiteFooter({ onOpenSearch }: SiteFooterProps) {
  return (
    <footer className="site-footer">
      <div className="footer-inner wrap">
        <div>
          <div className="footer-brand">Nostalgia Radio</div>
          <p className="footer-note">
            A public listening page. No accounts, no tracking, no database — favourites and volume
            stay on this device. Only stream what you are licensed to stream.
          </p>
        </div>

        <nav className="footer-links" aria-label="Footer">
          <button type="button" onClick={onOpenSearch}>
            Search
          </button>
          <a href={GITHUB} target="_blank" rel="noopener noreferrer">
            Source
          </a>
          <a href={`${GITHUB}#readme`} target="_blank" rel="noopener noreferrer">
            About
          </a>
        </nav>
      </div>
    </footer>
  );
}
