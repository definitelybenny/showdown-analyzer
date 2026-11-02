// All styles live under #sa-root. Theme: CSS variables, light by default, dark when the client sets `html.dark`
// (the client tracks the OS setting itself, so we follow its class rather than prefers-color-scheme).
import { ROOT_ID } from '../host/detect.js';

export const STYLE_ID = 'sa-ui-style';
const R = '#' + ROOT_ID;

export const CSS = `
${R}{
  --sa-fg:#222; --sa-muted:#6b6b6b; --sa-border:rgba(0,0,0,.16); --sa-card:rgba(0,0,0,.035); --sa-card2:rgba(0,0,0,.07);
  --sa-accent:#2f66ad; --sa-accent-fg:#fff; --sa-good:#237a36; --sa-mid:#8a6400; --sa-bad:#b3261e; --sa-input:#fff;
  --sa-warn-bg:#fff4d6;
  position:relative; box-sizing:border-box; padding:8px 10px 24px; color:var(--sa-fg); font-size:12px; line-height:1.45; font-family:inherit;
  text-align:left; max-width:100%; overflow-x:hidden;
}
html.dark ${R}{
  color-scheme:dark;
  --sa-fg:#e6e6e6; --sa-muted:#a0a0a0; --sa-border:rgba(255,255,255,.2); --sa-card:rgba(255,255,255,.06); --sa-card2:rgba(255,255,255,.12);
  --sa-accent:#6ea6f0; --sa-accent-fg:#0b1a2e; --sa-good:#5fcf7a; --sa-mid:#e5b84a; --sa-bad:#ff7b72; --sa-input:#1e2126;
  --sa-warn-bg:#3a3217;
}
${R} *, ${R} *::before, ${R} *::after{box-sizing:border-box}
${R} h2, ${R} h3, ${R} h4, ${R} p{margin:0; font-weight:bold; color:inherit; text-shadow:none; border:0; padding:0}
${R} p{font-weight:normal}
${R} .sa-h3{font-size:13px; margin:14px 0 6px; display:flex; align-items:baseline; gap:6px; flex-wrap:wrap}
${R} .sa-h3-sub{font-size:11px; font-weight:normal; color:var(--sa-muted)}
${R} .sa-muted{color:var(--sa-muted)}
${R} button, ${R} input, ${R} select, ${R} textarea{font:inherit; font-size:12px; color:var(--sa-fg); margin:0; text-shadow:none; box-shadow:none; border-radius:4px; max-width:100%}
${R} input, ${R} select, ${R} textarea{background:var(--sa-input); border:1px solid var(--sa-border); padding:4px 6px; min-height:28px; height:auto; width:auto}
${R} textarea{width:100%; min-height:60px; resize:vertical; display:block}
${R} input:focus-visible, ${R} select:focus-visible, ${R} textarea:focus-visible, ${R} button:focus-visible, ${R} a:focus-visible, ${R} summary:focus-visible, ${R} [tabindex]:focus-visible{outline:2px solid var(--sa-accent); outline-offset:1px}
${R} a{color:var(--sa-accent)}
${R} .sa-btn{background:var(--sa-card); border:1px solid var(--sa-border); padding:4px 10px; min-height:28px; cursor:pointer; line-height:1.2; text-shadow:none; background-image:none; width:auto; height:auto; float:none}
${R} .sa-btn:hover{background:var(--sa-card2)}
${R} .sa-btn:disabled{opacity:.5; cursor:default}
${R} .sa-btn.sa-primary, ${R} .sa-tab[aria-selected=true]{background:var(--sa-accent); border-color:var(--sa-accent); color:var(--sa-accent-fg); font-weight:bold}
${R} .sa-btn.sa-danger{color:var(--sa-bad); border-color:var(--sa-bad)}
${R} .sa-btn.sa-danger.sa-armed{background:var(--sa-bad); color:#fff}
${R} .sa-btn.sa-small{padding:1px 6px; min-height:22px}

/* navigation: horizontally scrollable row so it works at 360px */
${R} .sa-nav{display:flex; gap:4px; overflow-x:auto; padding-bottom:4px; margin-bottom:6px; scrollbar-width:thin}
${R} .sa-tab{flex:0 0 auto}
${R} .sa-status{display:flex; flex-wrap:wrap; gap:4px 12px; font-size:11px; color:var(--sa-muted); margin:2px 0 6px}
${R} .sa-live{color:var(--sa-accent); font-weight:bold}
${R} .sa-banner{background:var(--sa-warn-bg); border:1px solid var(--sa-border); border-radius:4px; padding:6px 8px; margin:6px 0; font-size:11px}

/* filters */
${R} .sa-filterbar{margin:4px 0 8px}
${R} .sa-filterhead{display:flex; gap:6px; align-items:center; flex-wrap:wrap}
${R} .sa-filterpanel{display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:6px 10px; margin-top:6px; padding:8px; background:var(--sa-card); border:1px solid var(--sa-border); border-radius:6px}
${R} .sa-field{display:flex; flex-direction:column; gap:2px; min-width:0}
${R} .sa-field > span{font-size:10px; color:var(--sa-muted); text-transform:uppercase; letter-spacing:.04em}
${R} .sa-field input, ${R} .sa-field select{width:100%}
${R} .sa-field-wide{grid-column:1/-1}
${R} .sa-check{flex-direction:row; align-items:center; gap:6px}
${R} .sa-field.sa-check > span{font-size:12px; color:var(--sa-fg); text-transform:none; letter-spacing:0}
${R} .sa-check input{min-height:0; width:auto}
${R} .sa-chips{display:flex; flex-wrap:wrap; gap:4px; align-items:center}
${R} .sa-chip{display:inline-flex; align-items:center; gap:4px; background:var(--sa-card2); border-radius:10px; padding:1px 8px; font-size:11px; line-height:1.5}
${R} .sa-chip button{background:none; border:0; padding:0 2px; min-height:0; cursor:pointer; color:inherit; font-size:13px; line-height:1}

/* summary tiles */
${R} .sa-tiles{display:grid; grid-template-columns:repeat(auto-fit,minmax(78px,1fr)); gap:6px; margin:4px 0 8px}
${R} .sa-stat{background:var(--sa-card); border-radius:6px; padding:6px 8px; min-width:0}
${R} .sa-stat-label{font-size:10px; color:var(--sa-muted); text-transform:uppercase; letter-spacing:.04em}
${R} .sa-stat-value{font-size:16px; font-weight:bold}
${R} .sa-stat-sub{font-size:10px; color:var(--sa-muted)}

/* cards and lists */
${R} .sa-list{display:flex; flex-direction:column; gap:6px; padding:0; margin:0; list-style:none}
${R} .sa-card{background:var(--sa-card); border:1px solid var(--sa-border); border-radius:6px; padding:8px; min-width:0}
${R} .sa-card.sa-click{cursor:pointer}
${R} .sa-card.sa-click:hover{border-color:var(--sa-accent)}
${R} .sa-row{display:flex; align-items:center; gap:6px; flex-wrap:wrap; min-width:0}
${R} .sa-row .sa-grow{flex:1 1 80px; min-width:0}
${R} .sa-title{font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
${R} .sa-sub{font-size:11px; color:var(--sa-muted)}
${R} .sa-teamline{display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:4px}
${R} .sa-teamline .sa-lbl{font-size:10px; color:var(--sa-muted); width:28px; flex:0 0 28px; text-transform:uppercase}
${R} .sa-result{display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:4px; font-weight:bold; font-size:12px; flex:0 0 22px; color:#fff}
${R} .sa-result-win{background:var(--sa-good)} ${R} .sa-result-loss{background:var(--sa-bad)}
${R} .sa-result-tie, ${R} .sa-result-unknown{background:var(--sa-muted)}
html.dark ${R} .sa-result{color:#0b1a2e}
${R} .sa-pill{display:inline-block; border:1px solid var(--sa-border); border-radius:10px; padding:0 7px; font-size:10px; color:var(--sa-muted); white-space:nowrap}
${R} .sa-pill.sa-pill-good{color:var(--sa-good); border-color:var(--sa-good)}
${R} .sa-pill.sa-pill-bad{color:var(--sa-bad); border-color:var(--sa-bad)}
${R} .sa-pill.sa-pill-mid{color:var(--sa-mid); border-color:var(--sa-mid)}
${R} .sa-delta-up{color:var(--sa-good)} ${R} .sa-delta-down{color:var(--sa-bad)}

/* pokemon icons: the client sheet icon is 40x30 */
${R} .sa-icons{display:inline-flex; flex-wrap:wrap; gap:0}
${R} .sa-iconwrap{position:relative; display:inline-block; width:40px; height:30px; flex:0 0 40px}
${R} .sa-icon{display:inline-block; width:40px; height:30px; vertical-align:top}
${R} .sa-icon-img{object-fit:contain; background:none; border:0; padding:0; margin:0; max-width:40px}
${R} .sa-icon-text{font-size:9px; line-height:30px; text-align:center; overflow:hidden; color:var(--sa-muted)}
${R} .sa-dim{opacity:.35; filter:grayscale(1)}
${R} .sa-iconwrap:has(.sa-lead)::after{content:'';position:absolute;left:6px;right:6px;bottom:-1px;height:2px;border-radius:1px;background:var(--sa-accent)}
${R} .sa-badge-m{position:absolute; right:1px; bottom:0; background:var(--sa-accent); color:var(--sa-accent-fg); font-size:8px; font-weight:bold; line-height:10px; padding:0 2px; border-radius:2px}

/* win rate */
${R} .sa-wr{display:inline-flex; align-items:baseline; gap:4px; white-space:nowrap}
${R} .sa-wr-pct{font-weight:bold}
${R} .sa-wr-n{font-size:10px; color:var(--sa-muted)}
${R} .sa-tone-good .sa-wr-pct{color:var(--sa-good)} ${R} .sa-tone-mid .sa-wr-pct{color:var(--sa-mid)} ${R} .sa-tone-bad .sa-wr-pct{color:var(--sa-bad)}
${R} .sa-lowN{opacity:.55}
${R} .sa-lowN .sa-wr-pct{font-weight:normal; font-style:italic}

/* stat cards (usage / matchups) */
${R} .sa-statgrid{display:grid; grid-template-columns:repeat(auto-fit,minmax(92px,1fr)); gap:4px 10px; margin-top:6px}
${R} .sa-statgrid .sa-cell-label{font-size:10px; color:var(--sa-muted); text-transform:uppercase; letter-spacing:.03em}
${R} .sa-statgrid .sa-cell-val{font-size:12px}
${R} .sa-bar{height:4px; background:var(--sa-card2); border-radius:2px; overflow:hidden; margin-top:2px}
${R} .sa-bar > i{display:block; height:100%; background:var(--sa-accent)}
${R} .sa-cols{display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:6px}
${R} .sa-mini{display:flex; align-items:center; gap:6px; padding:3px 0; border-bottom:1px solid var(--sa-border)}
${R} .sa-mini .sa-grow{flex:1 1 auto; min-width:0}
${R} .sa-mini:last-child{border-bottom:0}

/* moves */
${R} .sa-moverow{display:grid; grid-template-columns:minmax(80px,1.2fr) 2fr auto; gap:6px; align-items:center; padding:1px 0}
${R} .sa-moverow .sa-bar{margin:0; height:8px}
${R} .sa-move-in .sa-bar > i{background:var(--sa-good)} ${R} .sa-move-out .sa-bar > i{background:var(--sa-bad)} ${R} .sa-move-unk .sa-bar > i{background:var(--sa-accent)}
${R} .sa-move-out .sa-moveName{color:var(--sa-bad)}

/* detail */
${R} .sa-sheets{display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:8px}
${R} .sa-mon{display:flex; gap:6px; padding:4px 0; border-bottom:1px solid var(--sa-border)}
${R} .sa-mon:last-child{border-bottom:0}
${R} .sa-mon-body{min-width:0; flex:1}
${R} .sa-mon-moves{font-size:11px; color:var(--sa-muted)}
${R} .sa-mon-moves b{color:var(--sa-fg)}
${R} .sa-tags{display:flex; gap:4px; flex-wrap:wrap; margin:2px 0}
${R} .sa-setgame{display:flex; gap:6px; align-items:center; flex-wrap:wrap; padding:4px 0; border-top:1px solid var(--sa-border); cursor:pointer}
${R} .sa-setgame.sa-notplayed{cursor:default; color:var(--sa-muted)}

/* empty + misc */
${R} .sa-empty{text-align:center; padding:28px 12px; color:var(--sa-muted)}
${R} .sa-empty-title{font-size:14px; font-weight:bold; color:var(--sa-fg); margin-bottom:6px}
${R} .sa-empty p{margin:0 0 10px}
${R} .sa-errors{background:var(--sa-warn-bg); padding:4px 8px; font-size:11px; border-radius:4px}
${R} .sa-settings label.sa-field{margin:6px 0}
${R} .sa-note{font-size:11px; color:var(--sa-muted); margin:2px 0 6px}
${R} .sa-scroll{overflow-x:auto}
${R} .sa-sr{position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap}
@media (max-width:420px){
  ${R}{padding:6px 6px 20px}
  ${R} .sa-statgrid{grid-template-columns:repeat(3,1fr)}
}
`;

export function injectStyle(doc) {
	if (doc.getElementById(STYLE_ID)) return;
	const el = doc.createElement('style');
	el.id = STYLE_ID;
	el.textContent = CSS;
	(doc.head || doc.documentElement).appendChild(el);
}
