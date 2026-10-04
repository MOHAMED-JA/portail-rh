"""Bloc « Les autres simulateurs » : même composant pour les trois applications (crédit, vie & CEA, automobile)."""
CSS = r"""
/* ---- Les autres simulateurs (bloc commun aux trois applications) ---- */
@property --xs-a { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
.xsim { position: relative; isolation: isolate; margin: 30px 0 10px; padding: 26px; border-radius: 28px; color: #eef2ff; overflow: hidden;
  background: radial-gradient(120% 140% at 0% 0%, #1c1f4a 0%, #0d1130 46%, #0a0d24 100%);
  box-shadow: 0 34px 70px -38px rgba(30, 27, 75, .95), inset 0 1px 0 rgba(255, 255, 255, .08); }
.xsim::before { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; opacity: .55;
  background-image: linear-gradient(rgba(148, 163, 255, .07) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 255, .07) 1px, transparent 1px);
  background-size: 34px 34px; -webkit-mask-image: radial-gradient(90% 80% at 50% 0%, #000 30%, transparent 85%); mask-image: radial-gradient(90% 80% at 50% 0%, #000 30%, transparent 85%); }
.xsim::after { content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none;
  background: conic-gradient(from var(--xs-a), rgba(129, 140, 248, .15), rgba(56, 189, 248, .85), rgba(192, 132, 252, .9), rgba(244, 114, 182, .6), rgba(129, 140, 248, .15) 70%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; animation: xs-tour 8s linear infinite; }
@keyframes xs-tour { to { --xs-a: 360deg; } }
.xsim-orbe { position: absolute; z-index: -1; width: 320px; height: 320px; border-radius: 50%; inset-inline-end: -90px; top: -170px; filter: blur(14px); pointer-events: none;
  background: radial-gradient(circle, rgba(99, 102, 241, .55), rgba(56, 189, 248, .18) 45%, transparent 68%); animation: xs-flotte 10s ease-in-out infinite alternate; }
@keyframes xs-flotte { to { transform: translate(-50px, 40px) scale(1.12); } }
.xsim-tete { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
.xsim-sur { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #a5b4fc; }
.xsim-sur::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: #38bdf8; box-shadow: 0 0 0 4px rgba(56, 189, 248, .18), 0 0 14px #38bdf8; animation: xs-pouls 2.4s ease-in-out infinite; }
@keyframes xs-pouls { 50% { box-shadow: 0 0 0 7px rgba(56, 189, 248, .05), 0 0 20px #38bdf8; } }
.xsim-titre { font-family: var(--font-display, inherit); margin: 6px 0 0; font-size: clamp(21px, 2.6vw, 27px); font-weight: 800; letter-spacing: -.02em; line-height: 1.15; color: #fff; }
.xsim-grille { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.xsim-carte { --c1: #6366f1; --c2: #c026d3; position: relative; isolation: isolate; overflow: hidden; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 16px;
  padding: 18px; border-radius: 20px; text-decoration: none; color: inherit; background: linear-gradient(150deg, rgba(255, 255, 255, .075), rgba(255, 255, 255, .025));
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .09), 0 18px 34px -24px rgba(0, 0, 0, .8); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  transition: transform 420ms cubic-bezier(.22, 1, .36, 1), box-shadow 420ms cubic-bezier(.22, 1, .36, 1), background 420ms; }
.xsim-carte::before { content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none; opacity: .55; transition: opacity 420ms;
  background: linear-gradient(130deg, var(--c1), transparent 45%, var(--c2));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; }
.xsim-carte::after { content: ""; position: absolute; inset: -40% -60%; z-index: -1; pointer-events: none; opacity: 0; transform: translateX(-60%);
  background: linear-gradient(105deg, transparent 40%, rgba(255, 255, 255, .16) 50%, transparent 60%); transition: transform 900ms cubic-bezier(.22, 1, .36, 1), opacity 300ms; }
.xsim-halo { position: absolute; z-index: -1; width: 180px; height: 180px; border-radius: 50%; inset-inline-start: -50px; top: -70px; pointer-events: none; opacity: .5;
  background: radial-gradient(circle, var(--c1), transparent 65%); filter: blur(18px); transition: opacity 420ms, transform 600ms cubic-bezier(.22, 1, .36, 1); }
.xsim-logo { width: 58px; height: 58px; flex: none; border-radius: 17px; box-shadow: 0 14px 28px -12px var(--c1), 0 0 0 1px rgba(255, 255, 255, .16); transition: transform 520ms cubic-bezier(.22, 1, .36, 1); }
.xsim-txt { display: grid; gap: 4px; min-width: 0; }
.xsim-txt strong { font-size: 16.5px; font-weight: 800; letter-spacing: -.01em; line-height: 1.25; color: #fff; }
.xsim-txt span { font-size: 13.5px; line-height: 1.45; color: rgba(226, 232, 255, .78); }
.xsim-fleche { width: 42px; height: 42px; flex: none; display: grid; place-items: center; border-radius: 50%; color: #fff;
  background: linear-gradient(140deg, var(--c1), var(--c2)); box-shadow: 0 10px 22px -10px var(--c2), inset 0 1px 0 rgba(255, 255, 255, .3);
  transition: transform 360ms cubic-bezier(.22, 1, .36, 1); }
.xsim-fleche svg { width: 19px; height: 19px; transition: transform 360ms cubic-bezier(.22, 1, .36, 1); }
[dir="rtl"] .xsim-fleche svg { transform: scaleX(-1); }
[dir="rtl"] .xsim-sur { letter-spacing: 0; }
.xsim-carte:focus-visible { outline: 3px solid #a5b4fc; outline-offset: 3px; }
.xsim-carte:active { transform: scale(.985); }
.xsim--credit { --c1: #a855f7; --c2: #ec4899; }
.xsim--vie { --c1: #6366f1; --c2: #c026d3; }
.xsim--auto { --c1: #3b82f6; --c2: #22d3ee; }
@media (hover: hover) and (pointer: fine) {
  .xsim-carte:hover { transform: translateY(-4px); background: linear-gradient(150deg, rgba(255, 255, 255, .11), rgba(255, 255, 255, .04)); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .12), 0 26px 44px -24px var(--c1); }
  .xsim-carte:hover::before { opacity: 1; }
  .xsim-carte:hover::after { opacity: 1; transform: translateX(60%); }
  .xsim-carte:hover .xsim-halo { opacity: .85; transform: scale(1.25); }
  .xsim-carte:hover .xsim-logo { transform: rotate(-6deg) scale(1.06); }
  .xsim-carte:hover .xsim-fleche { transform: scale(1.08); }
  .xsim-carte:hover .xsim-fleche svg { transform: translate(2px, -2px); }
  [dir="rtl"] .xsim-carte:hover .xsim-fleche svg { transform: scaleX(-1) translate(2px, -2px); }
}
@media (max-width: 760px) {
  .xsim { padding: 20px 16px; border-radius: 24px; }
  .xsim-grille { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .xsim-carte { gap: 14px; padding: 15px; }
  .xsim-sur { font-size: 11px; letter-spacing: .1em; }
  .xsim-logo { width: 50px; height: 50px; border-radius: 15px; }
  .xsim-fleche { width: 38px; height: 38px; }
}
@media (prefers-reduced-motion: reduce) { .xsim::after, .xsim-orbe, .xsim-sur::before { animation: none; } .xsim-carte, .xsim-carte::after, .xsim-logo, .xsim-fleche, .xsim-halo { transition: none; } }
@media print { .xsim { display: none !important; } }
"""

AM = '<path d="M5 5v14h14"/><path d="M8 8c3 .5 6 3.5 8.5 8"/><circle cx="16.6" cy="16" r=".75"/>'
SP = ('<path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/>'
      '<path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/>')
CAR = ('<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/>'
       '<circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>')
APPS = {
  'credit': dict(url='https://mohamed-ja.github.io/simulateur-credit/', titre='Simulateur de crédit',
                 desc="Mensualité, TEG et tableau d'amortissement, en dinars tunisiens.",
                 fond='<linearGradient id="xs-g-credit" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c3aed"/><stop offset=".6" stop-color="#c026d3"/><stop offset="1" stop-color="#db2777"/></linearGradient>',
                 fill='url(#xs-g-credit)', glyph=AM, tr='translate(32 32) scale(2.55) translate(-12 -12)', sw=1.8),
  'vie': dict(url='https://mohamed-ja.github.io/simulateur-assurance-vie/', titre='Simulateur Assurance Vie et CEA',
              desc="Économie d'impôt, montant optimal à investir et projection du capital.",
              fond='<linearGradient id="xs-g-vie" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset=".55" stop-color="#7c3aed"/><stop offset="1" stop-color="#c026d3"/></linearGradient>',
              fill='url(#xs-g-vie)', glyph=SP, tr='translate(32 32) scale(2.3) translate(-12 -12.5)', sw=1.9),
  'auto': dict(url='https://mohamed-ja.github.io/simulateur-Assurance-Automobile/', titre='Simulateur Assurance Automobile',
               desc='Prime détaillée par garantie, offre imprimable et constat amiable.',
               fond='<linearGradient id="xs-g-auto" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f5bea"/><stop offset="1" stop-color="#1e88e5"/></linearGradient>',
               fill='url(#xs-g-auto)', glyph=CAR, tr='translate(32 32) scale(2.35) translate(-12 -12.5)', sw=1.9),
}
SUR = 'Du même auteur · gratuits et installables'
TITRE = 'Les autres simulateurs'
FLECHE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>'

def html(self_app, attr=lambda txt: '', uid='xsim-titre'):
    """attr(texte) renvoie les attributs de traduction éventuels (ex. data-t pour le simulateur de crédit)."""
    cartes = []
    for k in [a for a in ('credit', 'vie', 'auto') if a != self_app]:
        a = APPS[k]
        gid = f'{uid}-{k}'  # identifiant de dégradé unique par bloc (deux blocs peuvent coexister sur une page)
        logo = (f'<svg class="xsim-logo" viewBox="0 0 64 64" aria-hidden="true"><defs>{a["fond"].replace(f"xs-g-{k}", gid)}</defs><rect width="64" height="64" rx="16" fill="url(#{gid})"/>'
                f'<g fill="none" stroke="#fff" stroke-width="{a["sw"]}" stroke-linecap="round" stroke-linejoin="round" transform="{a["tr"]}">{a["glyph"]}</g></svg>')
        cartes.append(f'''    <a class="xsim-carte xsim--{k}" href="{a['url']}" target="_blank" rel="noopener">
      <span class="xsim-halo" aria-hidden="true"></span>
      {logo}
      <span class="xsim-txt"><strong{attr(a['titre'])}>{a['titre']}</strong><span{attr(a['desc'])}>{a['desc']}</span></span>
      <span class="xsim-fleche" aria-hidden="true">{FLECHE}</span>
    </a>''')
    return f'''<section class="xsim" aria-labelledby="{uid}">
  <span class="xsim-orbe" aria-hidden="true"></span>
  <div class="xsim-tete"><div><span class="xsim-sur"{attr(SUR)}>{SUR}</span><h2 class="xsim-titre" id="{uid}"{attr(TITRE)}>{TITRE}</h2></div></div>
  <div class="xsim-grille">
''' + '\n'.join(cartes) + '''
  </div>
</section>'''
