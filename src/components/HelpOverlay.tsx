import { CloseIcon } from './Icons';

interface HelpOverlayProps {
  open: boolean;
  onClose: () => void;
}

/** Every keyboard shortcut the app exposes, in one small overlay. */
export function HelpOverlay({ open, onClose }: HelpOverlayProps) {
  if (!open) return null;

  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        style={{ width: 'min(520px, 100%)' }}
      >
        <div className="modal-body">
          <div className="modal-head">
            <p className="eyebrow" id="help-title">
              Keyboard controls
            </p>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close help">
              <CloseIcon size={16} />
            </button>
          </div>

          <dl className="help-list" style={{ marginTop: 'var(--space-5)' }}>
            <dt>Space</dt>
            <dd>Play / pause</dd>
            <dt>/</dt>
            <dd>Search the archive</dd>
            <dt>← →</dt>
            <dd>Seek, or change station when nothing is seekable</dd>
            <dt>M</dt>
            <dd>Mute</dd>
            <dt>S</dt>
            <dd>Share the current station</dd>
            <dt>R</dt>
            <dd>Surprise station</dd>
            <dt>Esc</dt>
            <dd>Close any overlay</dd>
          </dl>

          <p className="footer-note" style={{ marginTop: 'var(--space-5)' }}>
            Every shortcut also has a visible control on the page — nothing is hidden behind the
            keyboard alone.
          </p>
        </div>
      </div>
    </div>
  );
}
