/* ==========================================================================
   40. RÈGLES VELTARIS : HORAIRES, POINTAGE, AUTORISATIONS, MESSAGERIE,
       POINTEUSE
   - horaire 8h–12h / 13h–17h, séance unique 8h–14h en juillet et août,
     samedi et dimanche en repos ;
   - chaque passage de badge est affiché ; première entrée et dernière sortie
     font référence ; pas d'anomalie sans pointage entre 12h et 13h ; un
     nombre de passages impair est une anomalie ;
   - autorisation : 1h30 au plus, 4h par mois, dérogation au-delà (RH) ;
   - congé : week-ends de début et de fin non comptés, fériés exclus.
   ========================================================================== */
Object.assign(REGLES, {
  heureArrivee: "08:00", heureDepart: "17:00", pauseDebut: "12:00", pauseFin: "13:00",
  moisSeanceUnique: [7, 8], heureArriveeEte: "08:00", heureDepartEte: "14:00",
  maxAutorisationHeures: 1.5, quotaAutorisationMois: 4, dureeJournee: 8,
});

const dureeHm = (minutes) => {
  const m = Math.round(minutes);
  return m % 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${Math.floor(m / 60)}h`;
};
function heuresAutorisationMois(matricule, jour) {
  const mois = iso(jour).slice(0, 7);
  return DEMANDES.filter((d) => d.matricule === matricule && d.type === "autorisation"
      && ["en_attente", "approuvee"].includes(d.statut) && String(d.debut).slice(0, 7) === mois)
    .reduce((s, d) => {
      if (!d.heureDebut || !d.heureFin) return s;
      const [a, b] = d.heureDebut.split(":").map(Number), [c, e] = d.heureFin.split(":").map(Number);
      return s + Math.max(0, (c * 60 + e) - (a * 60 + b)) / 60;
    }, 0);
}
/* Passages d'une journée : ceux du serveur, sinon les colonnes historiques. */
const passagesDe = (p) => (p.passages && p.passages.length ? p.passages : [p.e1, p.s1, p.e2, p.s2].filter(Boolean));

const versPointageLocalAvantPassages = versPointageLocal;
versPointageLocal = function (p) { return { ...versPointageLocalAvantPassages(p), passages: p.passages || [] }; };
const versDemandeLocaleAvantDerogation = versDemandeLocale;
versDemandeLocale = function (d) { return { ...versDemandeLocaleAvantDerogation(d), derogation: !!d.derogation_rh }; };

/* --- Pointages : chaque passage, première entrée, dernière sortie ---------- */
ongletPointages = function (f) {
  const lignes = POINTAGES.filter((p) => p.matricule === f.employe).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);
  if (!lignes.length) return etatVide("horloge", "Aucun pointage", "Les passages à la pointeuse s'affichent ici dès leur enregistrement.");
  return `<div class="bandeau-info" style="margin-bottom:12px">${ico("horloge")}<span>Horaire : <strong>8h–12h / 13h–17h</strong> du lundi au vendredi ·
    juillet et août : <strong>séance unique 8h–14h</strong>. Ne pas badger entre 12h et 13h n'est pas une anomalie ;
    un <strong>nombre de pointages impair</strong> l'est (entrée ou sortie manquante).</span></div>
  <div class="tableau-boite"><table style="min-width:820px">
    <thead><tr><th>Jour</th><th>Pointages</th><th class="centre">Première entrée</th><th class="centre">Dernière sortie</th>
      <th class="centre">Heures</th><th class="centre">Retard</th><th>État</th></tr></thead>
    <tbody>${lignes.map((p) => {
      const [libelle, couleur, fond] = CODES_PRESENCE[p.code] || CODES_PRESENCE.present;
      const passages = passagesDe(p);
      const anomalies = ANOMALIES.filter((a) => a.matricule === p.matricule && a.date === p.date);
      const impair = passages.length % 2 === 1;
      return `<tr>
        <td><strong>${fmtJourCourt(p.date)}</strong></td>
        <td><div class="passages">${passages.map((h, i) => `<span class="passage ${impair && i === passages.length - 1 ? "orphelin" : i % 2 ? "sortie" : "entree"}" title="${i % 2 ? "Sortie" : "Entrée"}">${h}</span>`).join("") || "—"}</div></td>
        <td class="centre mono">${passages[0] || "—"}</td>
        <td class="centre mono">${passages.length >= 2 ? passages[passages.length - 1] : "—"}</td>
        <td class="centre num"><strong>${fmtNombre(p.heures)}</strong> <span style="color:var(--encre-3)">/ ${fmtNombre(p.prevues)}</span></td>
        <td class="centre num" style="color:${p.retard ? "var(--danger)" : "var(--encre-3)"}">${p.retard ? `+${p.retard} min` : "—"}</td>
        <td><span class="badge" style="background:${fond};color:${couleur}">${libelle}</span>
          ${anomalies.map((a) => `<span class="badge ${a.statut === "ouverte" ? "rejetee" : "annulee"}" title="${echapper(a.detail || "")}">${ico("alerte")}${echapper(a.type)}</span>`).join(" ")}</td>
      </tr>`;
    }).join("")}</tbody>
  </table></div>`;
};

/* Présences affichées en direct : relues toutes les 20 secondes. */
setInterval(async () => {
  if (!connecte() || etat.route !== "/presences") return;
  try { await rafraichirPresences(); } catch { return; }
  if (!saisieEnCoursOuModale()) rendre(false);
}, 20000);

/* --- Dérogation visible dans le détail d'une demande ------------------------ */
const ouvrirDetailDemandeAvantDerogation = ouvrirDetailDemande;
ouvrirDetailDemande = function (ref) {
  ouvrirDetailDemandeAvantDerogation(ref);
  const d = DEMANDES.find((x) => x.ref === ref);
  const corps = $("#couche .tiroir-corps, #couche .modale-corps");
  if (d && d.derogation && corps) corps.insertAdjacentHTML("afterbegin",
    `<div class="bandeau-info alerte" style="margin-bottom:12px">${ico("alerte")}<span><strong>Dérogation :</strong> quota mensuel d'autorisations dépassé — décision réservée à la direction RH.</span></div>`);
};

/* --- Paramètres RH : horaires, autorisations, messagerie, pointeuse -------- */
const vueParametresAvantOutils = VUES["/parametres"];
VUES["/parametres"] = function () {
  const f = etat.filtres.parametres || (etat.filtres.parametres = { onglet: "types" });
  const special = ["messagerie", "pointeuse"].includes(f.onglet);
  const reel = f.onglet;
  if (special) f.onglet = "types";
  let html = vueParametresAvantOutils();
  f.onglet = reel;
  const boutons = [["messagerie", "Messagerie"], ["pointeuse", "Pointeuse"]]
    .map(([cle, libelle]) => `<button data-onglet="${cle}" class="${f.onglet === cle ? "actif" : ""}">${libelle}</button>`).join("");
  const debut = html.indexOf('id="parametres-onglets"');
  const fin = html.indexOf("</div>", debut);
  html = html.slice(0, fin) + boutons + html.slice(fin);
  if (!special) return html;
  html = html.replace('data-onglet="types" class="actif"', 'data-onglet="types" class=""');
  const entete = html.slice(0, html.indexOf("</div>", html.indexOf("</div>", debut) + 6) + 6);
  return `${entete}${f.onglet === "messagerie" ? vueMessagerie() : vuePointeuse()}</section>`;
};

function vueMessagerie() {
  if (!connecte()) return etatVide("cloche", "Disponible avec le serveur", "La messagerie se configure une fois le portail lancé avec DEMARRER.bat.");
  if (!etat.messagerie) {
    Promise.all([API.appel("/api/parametres/messagerie"), API.appel("/api/parametres/emails")])
      .then(([m, e]) => { etat.messagerie = m; etat.emailsListe = e; rendre(false); })
      .catch((souci) => toast("Messagerie indisponible", souci.message, "danger"));
    return `<div class="squelette" style="height:260px;border-radius:14px"></div>`;
  }
  const m = etat.messagerie;
  const statuts = { envoye: ["approuvee", "Envoyé"], en_file: ["attente", "En file"], erreur: ["rejetee", "Erreur"], non_configure: ["neutre", "Messagerie non configurée"] };
  return `<div class="grille" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));align-items:start">
    <article class="carte" style="box-shadow:none;display:flex;flex-direction:column;gap:12px">
      <h3>Serveur d'envoi (SMTP)</h3>
      <p style="font-size:12.5px;color:var(--encre-3)">Paramètres fournis par la direction informatique (Exchange / Microsoft 365 : <span class="mono">smtp.office365.com</span>, port 587, STARTTLS).</p>
      <label style="display:flex;gap:9px;align-items:center;font-size:13px"><input type="checkbox" id="mail-actif" ${m.actif ? "checked" : ""} style="width:17px;height:17px;accent-color:var(--marine)"> Envoyer les e-mails automatiquement</label>
      <div class="ligne-champs">
        <div class="champ"><label for="mail-serveur">Serveur</label><input class="saisie" id="mail-serveur" value="${echapper(m.serveur)}" placeholder="smtp.office365.com"></div>
        <div class="champ" style="max-width:110px"><label for="mail-port">Port</label><input class="saisie" type="number" id="mail-port" value="${m.port}"></div>
      </div>
      <div class="champ"><label for="mail-securite">Sécurité</label><select class="saisie" id="mail-securite">
        ${[["starttls", "STARTTLS (recommandé)"], ["ssl", "SSL/TLS"], ["aucune", "Aucune"]].map(([v, l]) => `<option value="${v}" ${m.securite === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="ligne-champs">
        <div class="champ"><label for="mail-utilisateur">Compte</label><input class="saisie" id="mail-utilisateur" value="${echapper(m.utilisateur)}" placeholder="portail.rh@veltaris.example"></div>
        <div class="champ"><label for="mail-mdp">Mot de passe</label><input class="saisie" type="password" id="mail-mdp" value="${echapper(m.mot_de_passe)}" autocomplete="new-password"></div>
      </div>
      <div class="champ"><label for="mail-expediteur">Expéditeur affiché</label><input class="saisie" id="mail-expediteur" value="${echapper(m.expediteur)}" placeholder="Portail RH <portail.rh@veltaris.example>"></div>
      <div class="champ"><label for="mail-url">Adresse du portail (liens des e-mails)</label><input class="saisie" id="mail-url" value="${echapper(m.url_application)}">
        <span class="aide">Les boutons Valider / Refuser des e-mails pointent vers cette adresse : elle doit être joignable par les destinataires (serveur de l'entreprise).</span></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn primaire" id="mail-enregistrer">${ico("check")} Enregistrer</button>
        <input class="saisie" id="mail-test-dest" placeholder="Adresse de test" style="flex:1;min-width:180px">
        <button class="btn" id="mail-tester">${ico("fleche")} Envoyer un test</button>
      </div>
    </article>
    <article class="carte" style="box-shadow:none">
      <div class="carte-entete"><h3>Derniers e-mails</h3><button class="btn petit fantome" id="mail-actualiser">${ico("horloge")} Actualiser</button></div>
      ${(etat.emailsListe || []).length ? `<div class="tableau-boite"><table style="min-width:auto"><tbody>
        ${etat.emailsListe.map((e) => { const [c, l] = statuts[e.statut] || ["neutre", e.statut]; return `<tr>
          <td style="font-size:12px"><strong>${echapper(e.sujet)}</strong><div style="color:var(--encre-3)">${echapper(e.destinataire)} · ${tempsRelatif(dateServeur(e.cree_le))}</div>
          ${e.erreur ? `<div style="color:var(--danger);font-size:11.5px">${echapper(e.erreur)}</div>` : ""}</td>
          <td class="droite"><span class="badge ${c}">${l}</span></td></tr>`; }).join("")}
      </tbody></table></div>` : etatVide("cloche", "Aucun e-mail", "Les demandes déposées et les décisions génèrent des e-mails.")}
    </article>
  </div>`;
}

function vuePointeuse() {
  if (!connecte()) return etatVide("horloge", "Disponible avec le serveur", "La liaison avec la pointeuse se configure une fois le portail lancé avec DEMARRER.bat.");
  if (!etat.pointeuseEtat) {
    API.appel("/api/pointeuse/etat").then((e) => { etat.pointeuseEtat = e; rendre(false); })
      .catch((souci) => toast("Pointeuse indisponible", souci.message, "danger"));
    return `<div class="squelette" style="height:260px;border-radius:14px"></div>`;
  }
  const e = etat.pointeuseEtat;
  const badges = Object.entries(e.badges || {}).map(([b, m]) => `${b};${m}`).join("\n");
  return `<div class="grille" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));align-items:start">
    <article class="carte" style="box-shadow:none;display:flex;flex-direction:column;gap:12px">
      <h3>Liaison directe</h3>
      <div class="ligne-champs">
        <div><div style="font-size:11.5px;color:var(--encre-3);font-weight:600">DERNIER CONTACT</div><strong>${e.dernier_contact ? fmtDateLongue(e.dernier_contact.slice(0, 10)) + " à " + e.dernier_contact.slice(11, 16) : "Jamais"}</strong></div>
        <div><div style="font-size:11.5px;color:var(--encre-3);font-weight:600">PASSAGES REÇUS</div><strong>${e.passages_total}</strong></div>
      </div>
      <div class="champ"><label>Clé de la pointeuse</label>
        <div class="cle-pointeuse" id="cle-pointeuse">${"•".repeat(24)}</div>
        <div style="display:flex;gap:8px;margin-top:6px">
          <button class="btn petit" id="cle-afficher">${ico("oeil")} Afficher</button>
          <button class="btn petit" id="cle-copier">${ico("copie")} Copier</button>
          <button class="btn petit danger" id="cle-regenerer">${ico("alerte")} Nouvelle clé</button>
        </div>
        <span class="aide">À renseigner dans le connecteur (outils\\connecteur_pointeuse.py). Une nouvelle clé désactive l'ancienne.</span></div>
      <div class="champ"><label for="badges">Correspondance badge → matricule (si les badges ne portent pas le matricule)</label>
        <textarea class="saisie mono" id="badges" style="min-height:110px" placeholder="1024;100259&#10;1025;100281">${echapper(badges)}</textarea>
        <span class="aide">Une ligne par badge : numéro;matricule.</span></div>
      <button class="btn primaire" id="badges-enregistrer" style="align-self:flex-start">${ico("check")} Enregistrer la correspondance</button>
    </article>
    <article class="carte" style="box-shadow:none">
      <div class="carte-entete"><h3>Derniers passages reçus</h3><button class="btn petit fantome" id="pointeuse-actualiser">${ico("horloge")} Actualiser</button></div>
      ${e.derniers.length ? `<div class="tableau-boite"><table style="min-width:auto"><tbody>${e.derniers.map((p) => `<tr>
        <td style="font-size:12.5px"><strong>${echapper(p.nom)}</strong> <span class="mono" style="color:var(--encre-3)">${echapper(p.matricule)}</span></td>
        <td class="mono" style="font-size:12.5px">${fmtDate(String(p.horodatage).slice(0, 10))} ${String(p.horodatage).slice(11, 16)}</td>
        <td><span class="badge neutre">${echapper(p.source)}${p.terminal ? " · " + echapper(p.terminal) : ""}</span></td></tr>`).join("")}</tbody></table></div>`
        : etatVide("horloge", "Aucun passage reçu", "Lancez le connecteur de la pointeuse pour recevoir les pointages.")}
    </article>
  </div>`;
}

const brancherParametresAvantOutils = BRANCHEMENTS["/parametres"];
BRANCHEMENTS["/parametres"] = function () {
  brancherParametresAvantOutils();
  const f = etat.filtres.parametres;
  $$("#parametres-onglets button").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.onglet === "messagerie") etat.messagerie = null;
    if (b.dataset.onglet === "pointeuse") etat.pointeuseEtat = null;
  }));

  /* Workflow : horaires et autorisations ajoutés au formulaire des règles. */
  const bouton = $("#p-enregistrer");
  if (bouton && f.onglet === "workflow") {
    bouton.insertAdjacentHTML("beforebegin", `<div class="grille" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr));margin-top:16px">
      <article class="carte" style="box-shadow:none"><div class="carte-entete"><h3>Horaires de travail</h3></div>
        <div class="ligne-champs"><div class="champ"><label for="p-depart">Fin de journée</label><input class="saisie" type="time" id="p-depart" value="${REGLES.heureDepart}"></div>
          <div class="champ"><label for="p-pause1">Pause</label><div style="display:flex;gap:6px;align-items:center"><input class="saisie" type="time" id="p-pause1" value="${REGLES.pauseDebut}"> – <input class="saisie" type="time" id="p-pause2" value="${REGLES.pauseFin}"></div></div></div>
        <div class="ligne-champs" style="margin-top:10px"><div class="champ"><label for="p-ete1">Séance unique (été)</label><div style="display:flex;gap:6px;align-items:center"><input class="saisie" type="time" id="p-ete1" value="${REGLES.heureArriveeEte}"> – <input class="saisie" type="time" id="p-ete2" value="${REGLES.heureDepartEte}"></div></div>
          <div class="champ"><label for="p-mois-ete">Mois concernés</label><input class="saisie" id="p-mois-ete" value="${(REGLES.moisSeanceUnique || [7, 8]).join(", ")}"><span class="aide">Numéros de mois : 7, 8 = juillet, août.</span></div></div>
        <p style="font-size:12px;color:var(--encre-3);margin-top:8px">Samedi et dimanche : repos hebdomadaire.</p></article>
      <article class="carte" style="box-shadow:none"><div class="carte-entete"><h3>Autorisations d'absence</h3></div>
        <div class="ligne-champs"><div class="champ"><label for="p-max-aut">Maximum par autorisation (h)</label><input class="saisie" type="number" step="0.25" min="0.25" id="p-max-aut" value="${REGLES.maxAutorisationHeures}"></div>
          <div class="champ"><label for="p-quota-aut">Quota mensuel (h)</label><input class="saisie" type="number" step="0.5" min="0.5" id="p-quota-aut" value="${REGLES.quotaAutorisationMois}"></div></div>
        <p style="font-size:12px;color:var(--encre-3);margin-top:8px">Au-delà du quota mensuel, la demande devient une dérogation accordée uniquement par la direction RH.
          La prière du vendredi (13h–14h) est accordée d'office, chaque vendredi, hors quota.</p></article>
      <article class="carte" style="box-shadow:none"><div class="carte-entete"><h3>Acquisition des congés</h3></div>
        <div class="champ"><label for="p-acq">Jours acquis par mois écoulé</label><input class="saisie" type="number" step="0.25" min="0" max="5" id="p-acq" value="${REGLES.acquisitionMensuelle ?? 2.5}" style="width:110px">
          <span class="aide">Crédités automatiquement à tout le personnel le 1er de chaque mois, au titre du mois précédent.</span></div></article>
    </div>`);
    const clone = bouton.cloneNode(true);
    bouton.parentNode.replaceChild(clone, bouton);
    clone.addEventListener("click", async () => {
      const regles = {
        ...REGLES,
        seuilDoubleValidation: Number($("#p-seuil").value), delaiReponse: Number($("#p-delai").value), reportMax: Number($("#p-report").value),
        heureArrivee: $("#p-arrivee").value, toleranceRetard: Number($("#p-tolerance").value), dureeJournee: Number($("#p-duree").value),
        heureDepart: $("#p-depart").value, pauseDebut: $("#p-pause1").value, pauseFin: $("#p-pause2").value,
        heureArriveeEte: $("#p-ete1").value, heureDepartEte: $("#p-ete2").value,
        moisSeanceUnique: $("#p-mois-ete").value.split(/[,; ]+/).map(Number).filter((n) => n >= 1 && n <= 12),
        maxAutorisationHeures: Number($("#p-max-aut").value), quotaAutorisationMois: Number($("#p-quota-aut").value),
        validationAutomatique: $("#p-auto") ? $("#p-auto").checked : true,
        acquisitionMensuelle: $("#p-acq") ? Number($("#p-acq").value) : REGLES.acquisitionMensuelle,
        plafondReport: $("#p-plafond") ? Number($("#p-plafond").value) : (REGLES.plafondReport ?? 15),
      };
      try {
        if (connecte()) appliquerParametres(await API.appel("/api/parametres/regles", { methode: "PUT", corps: regles }));
        else Object.assign(REGLES, regles);
        toast("Règles enregistrées", "Horaires, autorisations et workflow s'appliquent dès maintenant.", "succes");
        rendre(false);
      } catch (souci) { toast("Enregistrement refusé", souci.message, "danger"); }
    });
  }

  if (f.onglet === "messagerie" && $("#mail-enregistrer")) {
    const lire = () => ({ actif: $("#mail-actif").checked, serveur: $("#mail-serveur").value.trim(), port: Number($("#mail-port").value) || 587,
      securite: $("#mail-securite").value, utilisateur: $("#mail-utilisateur").value.trim(), mot_de_passe: $("#mail-mdp").value,
      expediteur: $("#mail-expediteur").value.trim(), url_application: $("#mail-url").value.trim() || "http://127.0.0.1:8100" });
    $("#mail-enregistrer").addEventListener("click", async () => {
      try { etat.messagerie = await API.appel("/api/parametres/messagerie", { methode: "PUT", corps: lire() }); toast("Messagerie enregistrée", etat.messagerie.actif ? "Les e-mails partent automatiquement." : "Envoi automatique désactivé.", "succes"); rendre(false); }
      catch (souci) { toast("Enregistrement refusé", souci.message, "danger"); }
    });
    $("#mail-tester").addEventListener("click", async () => {
      const destinataire = $("#mail-test-dest").value.trim();
      if (!destinataire.includes("@")) return toast("Adresse requise", "Indiquez l'adresse qui recevra le test.", "danger");
      try { await API.appel("/api/parametres/messagerie", { methode: "PUT", corps: lire() });
        await API.appel("/api/parametres/messagerie/test", { methode: "POST", corps: { destinataire } });
        toast("E-mail de test envoyé", destinataire, "succes"); }
      catch (souci) { toast("Test échoué", souci.message, "danger"); }
    });
    $("#mail-actualiser").addEventListener("click", () => { etat.messagerie = null; rendre(false); });
  }

  if (f.onglet === "pointeuse" && $("#cle-afficher")) {
    const e = etat.pointeuseEtat;
    $("#cle-afficher").addEventListener("click", () => { $("#cle-pointeuse").textContent = e.cle; });
    $("#cle-copier").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(e.cle); toast("Clé copiée", "Collez-la dans la configuration du connecteur.", "succes"); }
      catch { $("#cle-pointeuse").textContent = e.cle; toast("Copie impossible", "Sélectionnez la clé affichée et copiez-la.", "alerte"); }
    });
    $("#cle-regenerer").addEventListener("click", async () => {
      if (!confirm("Générer une nouvelle clé ? Le connecteur devra être reconfiguré.")) return;
      try { etat.pointeuseEtat.cle = (await API.appel("/api/pointeuse/cle", { methode: "POST" })).cle; toast("Nouvelle clé générée", "Mettez à jour le connecteur.", "alerte"); rendre(false); }
      catch (souci) { toast("Action refusée", souci.message, "danger"); }
    });
    $("#badges-enregistrer").addEventListener("click", async () => {
      const badges = Object.fromEntries($("#badges").value.split(/\n+/).map((l) => l.split(/[;,\t]/).map((x) => x.trim())).filter((l) => l.length >= 2 && l[0] && l[1]));
      try { await API.appel("/api/pointeuse/badges", { methode: "PUT", corps: { badges } }); etat.pointeuseEtat = null; toast("Correspondance enregistrée", `${Object.keys(badges).length} badge(s).`, "succes"); rendre(false); }
      catch (souci) { toast("Enregistrement refusé", souci.message, "danger"); }
    });
    $("#pointeuse-actualiser").addEventListener("click", () => { etat.pointeuseEtat = null; rendre(false); });
  }
};
