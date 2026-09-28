import type { EditorialMoment } from '../types/station';

interface EditorialMomentProps {
  moment: EditorialMoment;
}

/** One sentence, one atmospheric scene, minimal controls — never a landing page. */
export function EditorialMoment({ moment }: EditorialMomentProps) {
  return (
    <section className="editorial" aria-label="Editorial">
      <img
        className="editorial-art"
        src={moment.artwork}
        alt=""
        loading="lazy"
        decoding="async"
      />
      <div className="wrap">
        <blockquote className="editorial-quote">“{moment.quote}”</blockquote>
        <p className="editorial-caption">{moment.caption}</p>
      </div>
    </section>
  );
}
