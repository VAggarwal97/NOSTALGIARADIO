import { useEffect, useState } from 'react';
import { SUPPORT_TIERS, SUPPORT_URL, SUPPORT_USES } from '../data/support';
import { CloseIcon, HeartIcon } from './Icons';

interface SupportViewProps {
  open: boolean;
  /** Current station artwork — dimmed behind the view so the identity continues. */
  artwork: string | null;
  onClose: () => void;
}

/**
 * In-app support view (the "Donate" destination). Same single-screen identity:
 * no account, no stored data, one outbound payment link. The radio underneath
 * keeps playing while this is open.
 */
export function SupportView({ open, artwork, onClose }: SupportViewProps) {
  const [tier, setTier] = useState<number>(SUPPORT_TIERS[1]);
  const [custom, setCustom] = useState('');

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const customAmount = Number.parseInt(custom, 10);
  const amount = Number.isFinite(customAmount) && customAmount > 0 ? customAmount : tier;

  const proceed = () => {
    try {
      const url = new URL(SUPPORT_URL);
      url.searchParams.set('amount', String(amount));
      window.open(url.toString(), '_blank', 'noopener,noreferrer');
    } catch {
      /* malformed link — never navigate somewhere unvalidated */
    }
  };

  return (
    <div className="support" role="dialog" aria-modal="true" aria-labelledby="support-title">
      {artwork ? (
        <img className="support-art" src={artwork} alt="" aria-hidden="true" decoding="async" />
      ) : null}
      <div className="support-scrim" aria-hidden="true" />

      <div className="support-inner wrap">
        <div className="support-top">
          <p className="eyebrow">Support · No account · No database</p>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close support view">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="support-grid">
          <div className="support-main">
            <h1 className="support-title" id="support-title">
              Keep the radio
              <span className="line-2">alive.</span>
            </h1>

            <p className="support-lead">
              A small contribution keeps the station independent, the artwork handmade and the
              archive open for everyone. Nothing here asks for an account.
            </p>

            <fieldset className="support-amounts">
              <legend className="support-legend">Choose an amount</legend>

              <div className="amount-row">
                {SUPPORT_TIERS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="amount-chip"
                    aria-pressed={!custom && tier === value}
                    onClick={() => {
                      setTier(value);
                      setCustom('');
                    }}
                  >
                    ₹{value.toLocaleString('en-IN')}
                  </button>
                ))}
              </div>

              <label className="amount-custom">
                <span>Or a custom amount</span>
                <span className="amount-field">
                  <span aria-hidden="true">₹</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    placeholder="250"
                    value={custom}
                    onChange={(event) => setCustom(event.target.value)}
                  />
                </span>
              </label>
            </fieldset>

            <div className="support-actions">
              <button type="button" className="cta cta--primary" onClick={proceed}>
                <HeartIcon size={16} />
                Support ₹{amount.toLocaleString('en-IN')}
              </button>
              <button type="button" className="cta cta--secondary" onClick={onClose}>
                Back to the radio
              </button>
            </div>

            <p className="support-note">
              Continues to our secure payment page in a new tab. We never see a password — there
              isn’t one.
            </p>
          </div>

          <aside className="support-aside" aria-label="What support helps with">
            <p className="gallery-eyebrow">What it keeps alive</p>
            <ol className="support-uses">
              {SUPPORT_USES.map((use, index) => (
                <li key={use}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  {use}
                </li>
              ))}
            </ol>
            <p className="support-quote">
              Some songs don’t belong to a decade — they belong to a road, a chai stall and a
              Sunday afternoon. Thank you for keeping those sounds on the air.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
