/* ==========================================================================
   1. OUTILS — dates, formats, aléatoire déterministe, icônes
   ========================================================================== */
const $ = (sel, racine = document) => racine.querySelector(sel);
const $$ = (sel, racine = document) => [...racine.querySelectorAll(sel)];

const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MOIS_COURT = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

// Jours fériés tunisiens (fixes + fêtes religieuses saisies par la RH).
const FERIES = {
  "01-01": "Nouvel An", "01-14": "Fête de la Révolution", "03-20": "Fête de l'Indépendance",
  "04-09": "Jour des Martyrs", "05-01": "Fête du Travail", "07-25": "Fête de la République",
  "08-13": "Fête de la Femme", "10-15": "Fête de l'Évacuation", "12-17": "Fête de la Jeunesse",
};
const FERIES_MOBILES = { "2026-03-20": "Aïd el-Fitr", "2026-05-27": "Aïd el-Idha", "2026-08-25": "Mouled" };

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const depuisIso = (s) => { const [a, m, j] = s.split("-").map(Number); return new Date(a, m - 1, j); };
const ajouterJours = (d, n) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
const estFerie = (d) => FERIES[iso(d).slice(5)] || FERIES_MOBILES[iso(d)] || null;
const estOuvre = (d) => d.getDay() !== 0 && d.getDay() !== 6 && !estFerie(d);

function joursOuvres(debut, fin) {
  let n = 0, c = new Date(debut);
  while (c <= fin) { if (estOuvre(c)) n++; c = ajouterJours(c, 1); }
  return n;
}
/* Congé : les samedis et dimanches en début ou fin de période ne comptent pas,
   ceux compris dans la période comptent ; les jours fériés ne comptent jamais. */
function joursConge(debut, fin, demi = null) {
  let d = new Date(debut), f = new Date(fin);
  while (d <= f && (d.getDay() === 0 || d.getDay() === 6)) d = ajouterJours(d, 1);
  while (f >= d && (f.getDay() === 0 || f.getDay() === 6)) f = ajouterJours(f, -1);
  if (f < d) return 0;
  let n = 0;
  for (let c = new Date(d); c <= f; c = ajouterJours(c, 1)) if (!estFerie(c)) n++;
  if (demi && n >= 1) return n === 1 ? 0.5 : n - 0.5;
  return n;
}
const fmtDate = (s) => { const d = typeof s === "string" ? depuisIso(s) : s; return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; };
const fmtDateLongue = (s) => { const d = typeof s === "string" ? depuisIso(s) : s; return `${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`; };
const fmtJourCourt = (s) => { const d = typeof s === "string" ? depuisIso(s) : s; return `${JOURS[d.getDay()].slice(0, 3)} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; };
const fmtHeure = (h) => h == null ? "—" : h;
const fmtNombre = (n, d = 1) => Number(n).toFixed(d).replace(/\.0$/, "").replace(".", ",");

function tempsRelatif(date) {
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 172800) return "hier";
  if (diff < 604800) return `il y a ${Math.floor(diff / 86400)} j`;
  return fmtDate(date);
}
function semaineIso(d) {
  const c = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  c.setUTCDate(c.getUTCDate() + 4 - (c.getUTCDay() || 7));
  const debut = new Date(Date.UTC(c.getUTCFullYear(), 0, 1));
  const num = Math.ceil(((c - debut) / 86400000 + 1) / 7);
  return `${c.getUTCFullYear()}-S${String(num).padStart(2, "0")}`;
}
const lundiDe = (d) => ajouterJours(d, -(d.getDay() === 0 ? 6 : d.getDay() - 1));
const echapper = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Générateur pseudo-aléatoire déterministe : le jeu de démonstration est
   identique à chaque ouverture, les captures d'écran restent comparables. */
function prng(graine) {
  return function () {
    graine |= 0; graine = (graine + 0x6D2B79F5) | 0;
    let t = Math.imul(graine ^ (graine >>> 15), 1 | graine);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = prng(20260917);
const piocher = (liste) => liste[Math.floor(rnd() * liste.length)];
const entre = (min, max) => Math.floor(rnd() * (max - min + 1)) + min;

/* ------------------------------------------------------------------ Icônes */
const ICONES = {
  tableau: '<path d="M3 3h7v8H3zM14 3h7v5h-7zM14 11h7v10h-7zM3 14h7v7H3z"/>',
  demandes: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  horloge: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendrier: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  reglages: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  cloche: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  loupe: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  soleil: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  lune: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sortie: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  croix: '<path d="M18 6 6 18M6 6l12 12"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  alerte: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  telecharger: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  chevronG: '<path d="m15 18-6-6 6-6"/>',
  chevronD: '<path d="m9 18 6-6-6-6"/>',
  fleche: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  haut: '<path d="m18 15-6-6-6 6"/>',
  bas: '<path d="m6 9 6 6 6-6"/>',
  avion: '<path d="M17.8 19.2 16 11l3.5-3.5a2.1 2.1 0 0 0-3-3L13 8 4.8 6.2a.5.5 0 0 0-.5.8l3.4 3.4-2.9 2.9-1.9-.6a.5.5 0 0 0-.5.8l2.4 2.4 2.4 2.4a.5.5 0 0 0 .8-.5l-.6-1.9 2.9-2.9 3.4 3.4a.5.5 0 0 0 .8-.5z"/>',
  bouclier: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  batiment: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01"/>',
  signature: '<path d="M3 17c3.5 0 3.5-10 7-10s3.5 10 7 10c1.5 0 2.5-1 3-2"/><path d="M3 21h18"/>',
  import: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  filtre: '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
  oeil: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  poubelle: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  crayon: '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
  copie: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  menu: '<path d="M3 12h18M3 6h18M3 18h18"/>',
  portefeuille: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  diplome: '<circle cx="12" cy="8" r="5"/><path d="M8.2 12.5 7 22l5-3 5 3-1.2-9.5"/>',
  rapport: '<path d="M3 3v18h18"/><path d="m7 15 3.5-4 3 2.5L20 7"/>',
  grille: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
};
const ico = (nom, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nom] || ""}</svg>`;

/* ==========================================================================
   2. RÉFÉRENTIELS MÉTIER
   ========================================================================== */
const TYPES_CONGE = [
  { code: "annuel", libelle: "Congé annuel", solde: true },
  { code: "naissance", libelle: "Naissance d'un enfant", max: 2, justif: true },
  { code: "deces_conjoint_enfant", libelle: "Décès du conjoint ou d'un enfant", max: 3, justif: true },
  { code: "deces_parent", libelle: "Décès du père ou de la mère", max: 3, justif: true },
  { code: "deces_frere", libelle: "Décès frère", max: 2, justif: true },
  { code: "deces_grand_parent", libelle: "Décès du grand-père ou de la grand-mère", max: 1, justif: true },
  { code: "mariage_employe", libelle: "Mariage de l'employé", max: 3, justif: true },
  { code: "mariage_enfant", libelle: "Mariage de l'enfant", max: 1, justif: true },
  { code: "circoncision", libelle: "Circoncision de l'enfant", max: 1, justif: true },
  { code: "paternel", libelle: "Congé paternel", max: 2, justif: true },
  { code: "maladie", libelle: "Congé de maladie", justif: true },
  { code: "prenatal", libelle: "Congé prénatal", max: 30, justif: true },
  { code: "suspension", libelle: "Suspension" },
  { code: "mise_a_pied", libelle: "Mise à pied" },
];
const TYPES_AUTORISATION = [
  { code: "perso", libelle: "Perso" }, { code: "priere_vendredi", libelle: "Prière du vendredi" },
  { code: "professionnel", libelle: "Professionnel" }, { code: "formation", libelle: "Formation" },
  { code: "allaitement", libelle: "Heure d'allaitement" },
  { code: "mission_inspection", libelle: "Mission d'inspection" },
];
const TYPES_MISSION = [
  { code: "formation", libelle: "Formation" }, { code: "visite_risque", libelle: "Visite de risque" },
  { code: "teletravail", libelle: "Télétravail" }, { code: "foire", libelle: "Foire" },
  { code: "evenement", libelle: "Événement" }, { code: "reunion", libelle: "Réunion" },
];
const CATALOGUE = { conge: TYPES_CONGE, autorisation: TYPES_AUTORISATION, mission: TYPES_MISSION };
const libelleType = (type, code) => (CATALOGUE[type].find((t) => t.code === code) || {}).libelle || code;

const POSTES = {
  siege: { libelle: "Siège", couleur: "#1E4FA3" },
  agence: { libelle: "Agence", couleur: "#0E8A52" },
  teletravail: { libelle: "Télétravail", couleur: "#7A56C9" },
  formation: { libelle: "Formation", couleur: "#2C7BB8" },
  terrain: { libelle: "Terrain", couleur: "#C2632E" },
  astreinte: { libelle: "Astreinte", couleur: "#B8851F" },
};

const DEPARTEMENTS = [
  { code: "DSI", nom: "Systèmes d'Information", couleur: "#1E4FA3" },
  { code: "SIN", nom: "Sinistres", couleur: "#C2632E" },
  { code: "PRD", nom: "Production & Souscription", couleur: "#0E8A52" },
  { code: "COM", nom: "Commercial & Réseau", couleur: "#B8851F" },
  { code: "FIN", nom: "Finance & Comptabilité", couleur: "#7A56C9" },
  { code: "RH", nom: "Ressources Humaines", couleur: "#2C7BB8" },
];

const EMPLOYES = [
  ["VT0001", "Hugo", "Lefèvre", "Directeur Général Adjoint", "RH", "admin", null, 2009],
  ["VT0002", "Nadia", "Roche", "Directrice des Ressources Humaines", "RH", "admin", "VT0001", 2012],
  ["VT0003", "Karim", "Delorme", "Responsable DSI", "DSI", "validateur", "VT0001", 2014],
  ["VT0004", "Sophie", "Marchand", "Responsable Sinistres", "SIN", "validateur", "VT0001", 2011],
  ["VT0005", "Thomas", "Girard", "Responsable Production", "PRD", "validateur", "VT0001", 2013],
  ["VT0006", "Sonia", "Perret", "Directrice Commerciale", "COM", "validateur", "VT0001", 2010],
  ["VT0007", "Marc", "Aubert", "Responsable Financier", "FIN", "validateur", "VT0001", 2015],
  ["VT0010", "Julien", "Garnier", "Ingénieur Études & Développement", "DSI", "employe", "VT0003", 2021],
  ["VT0011", "Léa", "Fontaine", "Administratrice Systèmes", "DSI", "employe", "VT0003", 2019],
  ["VT0012", "Yanis", "Moreau", "Analyste Data", "DSI", "employe", "VT0003", 2022],
  ["VT0013", "Emma", "Bouvier", "Technicienne Support", "DSI", "employe", "VT0003", 2023],
  ["VT0020", "Inès", "Carré", "Gestionnaire Sinistres Auto", "SIN", "employe", "VT0004", 2018],
  ["VT0021", "Antoine", "Leroy", "Expert Sinistres IARD", "SIN", "employe", "VT0004", 2016],
  ["VT0022", "Leïla", "Brun", "Gestionnaire Sinistres Santé", "SIN", "employe", "VT0004", 2020],
  ["VT0023", "Bastien", "Renaud", "Inspecteur Règlement", "SIN", "employe", "VT0004", 2017],
  ["VT0030", "Adam", "Colin", "Souscripteur Entreprises", "PRD", "employe", "VT0005", 2015],
  ["VT0031", "Camille", "Vidal", "Chargée de Production Vie", "PRD", "employe", "VT0005", 2019],
  ["VT0032", "Mehdi", "Arnaud", "Actuaire", "PRD", "employe", "VT0005", 2021],
  ["VT0040", "Manon", "Picard", "Chargée de Clientèle", "COM", "employe", "VT0006", 2020],
  ["VT0041", "Samuel", "Faure", "Animateur Réseau Agences", "COM", "employe", "VT0006", 2018],
  ["VT0042", "Chloé", "Lemaire", "Conseillère Commerciale", "COM", "employe", "VT0006", 2022],
  ["VT0050", "Nicolas", "Gauthier", "Comptable", "FIN", "employe", "VT0007", 2017],
  ["VT0051", "Hélène", "Masson", "Contrôleuse de Gestion", "FIN", "employe", "VT0007", 2019],
  ["VT0060", "Maxime", "Roux", "Chargé de Formation", "RH", "employe", "VT0002", 2021],
  ["VT0061", "Amélie", "Guérin", "Gestionnaire Paie", "RH", "employe", "VT0002", 2016],
].map(([matricule, prenom, nom, poste, dept, role, validateur, annee]) => ({
  matricule, prenom, nom, poste, dept, role, validateur,
  entree: `${annee}-${String(entre(1, 12)).padStart(2, "0")}-${String(entre(1, 28)).padStart(2, "0")}`,
  email: `${prenom.split(" ")[0].toLowerCase()}.${nom.toLowerCase().replace(/\s/g, "")}@veltaris.example`,
  telephone: `+216 ${entre(20, 99)} ${entre(100, 999)} ${entre(100, 999)}`,
  statut: "actif",
}));

const parMatricule = Object.fromEntries(EMPLOYES.map((e) => [e.matricule, e]));
const nomComplet = (e) => `${e.prenom} ${e.nom}`;
const initiales = (e) => (e.prenom[0] + e.nom[0]).toUpperCase();
const couleurDept = (code) => (DEPARTEMENTS.find((d) => d.code === code) || {}).couleur || "#6D7D95";
const nomDept = (code) => (DEPARTEMENTS.find((d) => d.code === code) || {}).nom || "Non affecté";

/* ==========================================================================
   3. JEU DE DONNÉES DE DÉMONSTRATION
   ========================================================================== */
const AUJOURDHUI = new Date();
AUJOURDHUI.setHours(0, 0, 0, 0);
const ANNEE = AUJOURDHUI.getFullYear();

const SOLDES = {};
EMPLOYES.forEach((e) => {
  const anciennete = ANNEE - Number(e.entree.slice(0, 4));
  const acquis = 21 + Math.min(9, Math.floor(anciennete / 3));
  SOLDES[e.matricule] = { annee: ANNEE, acquis, report: piocher([0, 0, 1, 2, 3]), pris: 0 };
});

/* --- Pointages sur 150 jours : badgeage en 2 fois par demi-journée -------- */
const POINTAGES = [];
const ANOMALIES = [];
let idAnomalie = 1;
for (let recul = 150; recul >= 0; recul--) {
  const jour = ajouterJours(AUJOURDHUI, -recul);
  if (!estOuvre(jour)) continue;
  EMPLOYES.forEach((e) => {
    const tirage = rnd();
    let code = "present";
    if (tirage < 0.05) code = "conge";
    else if (tirage < 0.07) code = "absent";
    else if (tirage < 0.11) code = "mission";

    const p = { matricule: e.matricule, date: iso(jour), code, prevues: 8, e1: null, s1: null, e2: null, s2: null, heures: 0, retard: 0 };

    if (code === "present" || code === "mission") {
      const retard = piocher([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 4, 7, 13, 21, 36]);
      const hMin = 8 * 60 + 30 + retard;
      const pause = 12 * 60 + 30 + entre(-10, 15);
      const reprise = pause + entre(45, 75);
      const fin = 17 * 60 + entre(-15, 70);
      const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      p.e1 = hhmm(hMin); p.s1 = hhmm(pause); p.e2 = hhmm(reprise); p.s2 = hhmm(fin);
      p.retard = retard;

      const oubli = rnd();
      let manquant = null;
      if (oubli < 0.022) { p.s2 = null; manquant = "Sortie manquante"; }
      else if (oubli < 0.04) { p.e2 = null; manquant = "Entrée manquante"; }

      const mins = (h) => h ? Number(h.slice(0, 2)) * 60 + Number(h.slice(3)) : null;
      let total = 0;
      if (p.e1 && p.s1) total += mins(p.s1) - mins(p.e1);
      if (p.e2 && p.s2) total += mins(p.s2) - mins(p.e2);
      p.heures = Math.round((total / 60) * 100) / 100;

      if (manquant) {
        ANOMALIES.push({ id: idAnomalie++, matricule: e.matricule, date: p.date, type: manquant, detail: "Badgeage incomplet détecté automatiquement", statut: "ouverte" });
      } else if (retard > 20) {
        const justifiee = rnd() > 0.35;
        ANOMALIES.push({ id: idAnomalie++, matricule: e.matricule, date: p.date, type: "Retard", detail: `Retard de ${retard} minutes`, statut: justifiee ? "justifiee" : "ouverte", justification: justifiee ? "Embouteillages — justifié auprès du N+1" : null });
      }
    } else if (code === "absent" && rnd() < 0.5) {
      ANOMALIES.push({ id: idAnomalie++, matricule: e.matricule, date: p.date, type: "Absence non justifiée", detail: "Absence sans demande associée", statut: "ouverte" });
    }
    POINTAGES.push(p);
  });
}

/* --------------------------------------------------------------- Demandes */
const DEMANDES = [];
let compteurRef = 1200;
const COMMENTAIRES = [
  "Congé familial planifié de longue date.", "Repos annuel — dossiers transmis à l'équipe.",
  "Déplacement familial à Sfax.", "Vacances scolaires des enfants.",
  "Récupération après la clôture trimestrielle.",
];
const COMMENTAIRES_MISSION = [
  "Visite de risque client entreprise à Sousse.", "Séminaire produits IARD — Tunis.",
  "Réunion réseau agences du Grand Tunis.", "Télétravail validé dans le cadre de l'accord interne.",
  "Foire internationale de l'assurance — stand Veltaris.",
];

function creerDemande(employe, type, sousType, debut, fin, statut, extra = {}) {
  const prefixe = { conge: "CG", autorisation: "AU", mission: "MS" }[type];
  // Une demande déposée depuis l'application est horodatée à l'instant ; seules
  // les données de démonstration reçoivent une date de dépôt tirée dans le passé.
  let cree;
  if (extra.cree instanceof Date) {
    cree = extra.cree;
  } else {
    cree = ajouterJours(debut, -entre(3, 18));
    cree.setHours(entre(8, 17), piocher([0, 15, 30, 45]));
    if (cree > new Date()) cree = new Date(Date.now() - entre(2, 96) * 3600000);
  }
  const validateur = employe.validateur ? parMatricule[employe.validateur] : null;
  const jours = type === "autorisation" ? 0 : (type === "conge" ? joursConge(debut, fin) : joursOuvres(debut, fin)) || 1;
  const historique = [{ statut: "en_attente", acteur: employe.matricule, commentaire: "Demande soumise", date: new Date(cree) }];
  let dateValidation = null;
  if (statut === "approuvee" || statut === "rejetee") {
    dateValidation = new Date(cree.getTime() + entre(4, 52) * 3600000);
    historique.push({
      statut, acteur: validateur ? validateur.matricule : null,
      commentaire: statut === "approuvee" ? "Demande approuvée" : extra.motifRefus, date: dateValidation,
    });
  }
  const d = {
    ref: `${prefixe}-${ANNEE}-${++compteurRef}`, type, sousType, matricule: employe.matricule,
    debut: iso(debut), fin: iso(fin), jours, statut, cree, dateValidation,
    validateur: validateur ? validateur.matricule : null, historique, ...extra,
  };
  DEMANDES.push(d);
  return d;
}

EMPLOYES.forEach((e) => {
  let pris = 0;
  for (let i = 0; i < entre(1, 3); i++) {
    const sousType = piocher(["annuel", "annuel", "annuel", "maladie", "mariage_employe", "naissance", "deces_parent"]);
    const debut = ajouterJours(AUJOURDHUI, -entre(20, 140));
    const fin = ajouterJours(debut, entre(0, 4));
    const d = creerDemande(e, "conge", sousType, debut, fin, "approuvee", { commentaire: piocher(COMMENTAIRES) });
    if (sousType === "annuel") pris += d.jours;
  }
  if (rnd() < 0.62) {
    const debut = ajouterJours(AUJOURDHUI, entre(3, 40));
    creerDemande(e, "conge", "annuel", debut, ajouterJours(debut, entre(0, 5)), "en_attente", { commentaire: piocher(COMMENTAIRES) });
  }
  if (rnd() < 0.2) {
    const debut = ajouterJours(AUJOURDHUI, -entre(10, 60));
    creerDemande(e, "conge", "annuel", debut, ajouterJours(debut, 2), "rejetee", {
      commentaire: "Pont de fin de semaine",
      motifRefus: "Effectif insuffisant sur la période — merci de décaler d'une semaine.",
    });
  }
  for (let i = 0; i < entre(0, 3); i++) {
    // Une autorisation passée a forcément été tranchée : seules les demandes
    // à venir restent dans la file de validation.
    const futur = rnd() < 0.35;
    const jour = ajouterJours(AUJOURDHUI, futur ? entre(1, 21) : -entre(1, 80));
    const h = piocher([9, 10, 11, 14, 15]);
    const statut = futur ? "en_attente" : piocher(["approuvee", "approuvee", "approuvee", "rejetee"]);
    creerDemande(e, "autorisation", piocher(["perso", "priere_vendredi", "professionnel", "formation"]), jour, jour, statut, {
      heureDebut: `${String(h).padStart(2, "0")}:00`, heureFin: `${String(h + entre(1, 2)).padStart(2, "0")}:00`,
      commentaire: piocher(["Rendez-vous administratif", "Démarches bancaires", "Rendez-vous médical"]),
      ...(statut === "rejetee" ? { motifRefus: "Créneau incompatible avec la permanence de l'équipe." } : {}),
    });
  }
  for (let i = 0; i < entre(0, 2); i++) {
    const debut = ajouterJours(AUJOURDHUI, entre(-45, 25));
    creerDemande(e, "mission", piocher(["formation", "visite_risque", "teletravail", "reunion", "foire", "evenement"]),
      debut, ajouterJours(debut, entre(0, 3)),
      debut < AUJOURDHUI ? "approuvee" : piocher(["en_attente", "approuvee"]),
      { commentaire: piocher(COMMENTAIRES_MISSION) });
  }
  SOLDES[e.matricule].pris = Math.round(pris * 10) / 10;
});
DEMANDES.sort((a, b) => b.cree - a.cree);

/* -------------------------------------------------------------- Plannings */
const PLANNINGS = [];
const lundiCourant = lundiDe(AUJOURDHUI);
[-1, 0, 1].forEach((decalage) => {
  const lundi = ajouterJours(lundiCourant, decalage * 7);
  EMPLOYES.forEach((e) => {
    // La semaine suivante n'est volontairement pas complète : l'état vide
    // du planning doit être visible dans la démonstration.
    if (decalage === 1 && rnd() < 0.45) return;
    for (let j = 0; j < 5; j++) {
      const jour = ajouterJours(lundi, j);
      const poste = piocher(["siege", "siege", "siege", "siege", "agence", "agence", "teletravail", "teletravail", "formation", "terrain", "astreinte"]);
      PLANNINGS.push({
        id: `${e.matricule}-${iso(jour)}`, matricule: e.matricule, date: iso(jour), semaine: semaineIso(jour),
        poste, debut: "08:30", fin: poste === "astreinte" ? "20:00" : "17:00",
      });
    }
  });
});

/* ---------------------------------------------------------- Notifications */
const MODELES_NOTIF = [
  ["Demande approuvée", "Votre congé annuel a été approuvé par votre responsable.", "succes", "/mes-demandes"],
  ["Nouvelle demande à valider", "Une demande de congé attend votre décision.", "validation", "/validation"],
  ["Anomalie de pointage", "Sortie manquante détectée sur votre journée de travail.", "alerte", "/presences"],
  ["Planning publié", "Votre planning de la semaine prochaine est disponible.", "info", "/plannings"],
  ["Rappel de solde", "Il vous reste des jours à poser avant le 31 décembre.", "info", "/mes-demandes"],
];
const NOTIFICATIONS = [];
let idNotif = 1;
EMPLOYES.forEach((e) => {
  for (let i = 0; i < entre(3, 6); i++) {
    const [titre, message, type, lien] = piocher(MODELES_NOTIF);
    NOTIFICATIONS.push({
      id: idNotif++, matricule: e.matricule, titre, message, type, lien,
      lu: rnd() < 0.4, date: new Date(Date.now() - entre(1, 260) * 3600000),
    });
  }
});
NOTIFICATIONS.sort((a, b) => b.date - a.date);

/* ------------------------------------------------------------- Documents */
const DOCUMENTS = [];
let idDoc = 1;
EMPLOYES.forEach((e) => {
  for (let m = Math.max(1, AUJOURDHUI.getMonth() - 2); m <= AUJOURDHUI.getMonth() + 1; m++) {
    DOCUMENTS.push({ id: idDoc++, matricule: e.matricule, titre: `Bulletin de paie — ${String(m).padStart(2, "0")}/${ANNEE}`, categorie: "bulletin", periode: `${String(m).padStart(2, "0")}/${ANNEE}`, signe: false, signable: false, date: new Date(ANNEE, m - 1, 28) });
  }
  DOCUMENTS.push({ id: idDoc++, matricule: e.matricule, titre: "Attestation de travail", categorie: "attestation", periode: String(ANNEE), signe: false, signable: false, date: ajouterJours(AUJOURDHUI, -entre(10, 120)) });
  DOCUMENTS.push({ id: idDoc++, matricule: e.matricule, titre: "Charte de télétravail", categorie: "contrat", periode: String(ANNEE), signe: false, signable: true, date: ajouterJours(AUJOURDHUI, -entre(2, 30)) });
  DOCUMENTS.push({ id: idDoc++, matricule: e.matricule, titre: "Avenant — prime de performance", categorie: "contrat", periode: String(ANNEE), signe: false, signable: true, date: ajouterJours(AUJOURDHUI, -entre(1, 12)) });
});

const JOURNAL = [
  { action: "Import de pointages", cible: "pointeuse-siege-08.csv", acteur: "VT0002", detail: "312 lignes importées", date: ajouterJours(AUJOURDHUI, -2) },
  { action: "Ajustement de solde", cible: "VT0021", acteur: "VT0002", detail: "Report 2025 : +2 jours", date: ajouterJours(AUJOURDHUI, -4) },
  { action: "Création employé", cible: "VT0013", acteur: "VT0002", detail: "Emma Bouvier — DSI", date: ajouterJours(AUJOURDHUI, -11) },
  { action: "Modification workflow", cible: "Congé > 10 jours", acteur: "VT0001", detail: "Double validation activée", date: ajouterJours(AUJOURDHUI, -18) },
  { action: "Publication planning", cible: semaineIso(lundiCourant), acteur: "VT0002", detail: "25 collaborateurs concernés", date: ajouterJours(AUJOURDHUI, -6) },
];
