const { test, expect } = require("@playwright/test");

for (const [profil, matricule] of [["collaborateur", "VT0010"], ["RH", "VT0001"], ["manager", "VT0003"]]) {
  test(`toutes les rubriques du profil ${profil} se chargent`, async ({ page }) => {
    test.setTimeout(120_000);
    const erreurs = [];
    page.on("pageerror", (erreur) => erreurs.push(erreur.message));
    await connecter(page, matricule);
    const routes = await page.locator("[data-route]").evaluateAll((liens) =>
      [...new Set(liens.map((lien) => lien.dataset.route))]);
    expect(routes).toContain("/formations");
    if (profil === "RH") expect(routes).toContain("/administration");
    const contenus = new Map();
    for (const route of routes) {
      await page.locator(`[data-route="${route}"]`).first().click();
      await expect(page.locator("main#contenu")).toBeVisible();
      await expect(page.locator("main#contenu")).not.toBeEmpty();
      await expect.poll(() => page.evaluate(() => etat.route)).toBe(route);
      await expect.poll(() => page.evaluate(() => etat.vuesVisitees.has(etat.route))).toBe(true);
      await expect(page.locator("header.entete h1")).toHaveText(
        await page.evaluate((routeCourante) => titreVue(routeCourante), route));
      const contenu = await page.locator("main#contenu").innerText();
      expect(contenu.trim().length, `Rubrique vide : ${route}`).toBeGreaterThan(20);
      contenus.set(route, contenu.trim());
      expect(erreurs, `Erreurs sur ${route}`).toEqual([]);
    }
    expect(new Set(contenus.values()).size, `Rubriques au contenu identique : ${JSON.stringify([...contenus.keys()])}`)
      .toBe(contenus.size);
    expect(erreurs).toEqual([]);
  });
}

async function connecter(page, matricule) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#form-connexion")).toBeVisible();
  await expect(page.locator("#matricule")).toHaveAttribute("placeholder", "Votre matricule");
  await page.locator("#matricule").fill(matricule);
  await page.locator("#motdepasse").fill("demo2026");
  await page.locator('#form-connexion button[type="submit"]').click();
  await expect(page.locator("header.entete h1")).toHaveText("Tableau de bord", { timeout: 20_000 });
}

test("connexion collaborateur et navigation principales", async ({ page }) => {
  const erreurs = [];
  page.on("pageerror", (erreur) => erreurs.push(erreur.stack || erreur.message));
  await connecter(page, "VT0010");
  await page.locator('[data-route="/mes-demandes"]').first().click();
  await expect(page.locator("header.entete h1")).toHaveText("Mes demandes");
  await expect(page.locator("main#contenu")).toBeVisible();
  expect(erreurs).toEqual([]);
});

test("administration affiche import Excel et supervision", async ({ page }) => {
  const erreurs = [];
  page.on("pageerror", (erreur) => erreurs.push(erreur.stack || erreur.message));
  await connecter(page, "VT0001");
  await page.locator('[data-route="/administration"]').first().click();
  await expect(page.locator("header.entete h1")).toHaveText("Administration RH");

  await page.locator('[data-onglet="import"]').click();
  await expect(page.getByText("Affectations et dossiers RH en masse")).toBeVisible();
  await expect(page.locator("#telecharger-modele-rh")).toBeVisible();
  await expect(page.locator("#previsualiser-import-rh")).toBeVisible();

  await page.locator('[data-onglet="supervision"]').click();
  await expect(page.getByText("Traitements automatiques")).toBeVisible();
  await expect(page.getByText("Sauvegardes", { exact: true }).last()).toBeVisible();
  expect(erreurs).toEqual([]);
});

test("interface mobile conserve la navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await connecter(page, "VT0010");
  await expect(page.locator("nav.nav-mobile")).toBeVisible();
  await expect(page.locator(".accueil-mobile")).toBeVisible();
  await page.locator('nav.nav-mobile [data-route="/mes-demandes"]').click();
  await expect(page.locator("header.entete h1")).toHaveText("Mes demandes");
  await expect(page.locator(".accueil-mobile")).toHaveCount(0);
  await page.locator('nav.nav-mobile [data-action="plus"]').click();
  await expect(page.locator("#couche")).toContainText("Annuaire");
});

test("une rubrique non chargée signale l'erreur sans recopier le tableau de bord", async ({ page }) => {
  await connecter(page, "VT0010");
  await page.evaluate(() => { delete VUES["/formations"]; });
  await page.locator('[data-route="/formations"]').first().click();
  await expect(page.locator("header.entete h1")).toHaveText("Formations");
  await expect(page.locator("main#contenu")).toContainText("Rubrique indisponible");
  await expect(page.locator("main#contenu")).not.toContainText("Mes demandes récentes");
});

test("le cache PWA ne renvoie pas l'accueil à la place d'un module absent", async ({ page, context }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
    }
  });
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#form-connexion")).toBeVisible();
  const resultat = await page.evaluate(async () => {
    try {
      const reponse = await fetch("/assets/js/module-inexistant.js");
      return { erreur: false, type: reponse.headers.get("content-type"), statut: reponse.status };
    } catch { return { erreur: true }; }
  });
  expect(resultat).toEqual({ erreur: true });
});

test("replier l'organigramme conserve la position horizontale", async ({ page }) => {
  await connecter(page, "VT0010");
  await page.locator('[data-route="/organigramme"]').first().click();
  await expect(page.locator("#org-scene")).toBeVisible();
  await page.addStyleTag({ content: "#org-zoom{min-width:2400px!important}" });
  const avant = await page.locator("#org-scene").evaluate((scene) => {
    scene.scrollLeft = 700;
    return scene.scrollLeft;
  });
  expect(avant).toBeGreaterThan(500);
  await page.locator("#arbre-rien").click();
  const apres = await page.locator("#org-scene").evaluate((scene) => scene.scrollLeft);
  expect(Math.abs(apres - avant)).toBeLessThan(5);
});

test("prévisualiser le remplacement d'un responsable", async ({ page }) => {
  await connecter(page, "VT0001");
  await page.locator('[data-route="/administration"]').first().click();
  await page.locator('[data-onglet="affectations"]').click();
  await expect(page.getByText("Remplacer un responsable")).toBeVisible();
  await page.getByText("Remplacer un responsable").click();
  const responsable = await page.locator("#rr-responsable option").filter({ hasText: "VT0003" }).getAttribute("value");
  await page.locator("#rr-responsable").selectOption(responsable);
  const remplacant = await page.locator("#rr-remplacant option").filter({ hasText: "VT0010" }).getAttribute("value");
  await page.locator("#rr-remplacant").selectOption(remplacant);
  await page.locator("#rr-previsualiser").click();
  const rapport = page.locator("#rr-appliquer").locator("xpath=..");
  await expect(rapport).toContainText("Karim Delorme");
  await expect(rapport).toContainText("Julien Garnier");
  await expect(page.locator("#rr-appliquer")).toBeVisible();
});

test("le schéma des structures montre les unités sans effectif", async ({ page }) => {
  await connecter(page, "VT0001");
  await page.locator('[data-route="/organigramme"]').first().click();
  await expect(page.locator("#org-scene")).toBeVisible();
  await page.locator("#org-schema").click();
  await expect(page.locator(".str-arbre")).toBeVisible();
  // L'arbre des personnes ignore les unités vides ; le schéma les dessine toutes.
  const unites = await page.locator(".str-carte").count();
  const structures = await page.evaluate(async () => (await API.appel("/api/administration/departements")).length);
  expect(unites).toBe(structures);
  await expect(page.locator(".str-carte .str-rang").first()).toBeVisible();
});

test("l'administrateur RH cree puis supprime une structure", async ({ page }) => {
  await connecter(page, "VT0001");
  page.on("dialog", (boite) => boite.accept());
  await page.locator('[data-route="/organigramme"]').first().click();
  await page.locator("#org-schema").click();
  await expect(page.locator(".str-arbre")).toBeVisible();
  const avant = await page.locator(".str-carte").count();

  await page.locator("#schema-creer").click();
  await page.locator('#form-creer-structure [name="nom"]').fill("Département Recette");
  await page.locator('#form-creer-structure button[type="submit"]').click();
  await expect(page.getByText("Département Recette").first()).toBeVisible();
  expect(await page.locator(".str-carte").count()).toBe(avant + 1);

  // La corbeille n'apparait que sur une unite vide : la nouvelle en a une.
  const carte = page.locator(".str-carte").filter({ hasText: "Département Recette" });
  await carte.locator("[data-schema-supprimer]").click();
  await expect(page.locator(".str-carte").filter({ hasText: "Département Recette" })).toHaveCount(0);
  expect(await page.locator(".str-carte").count()).toBe(avant);
});

test("un valideur declare un remplacant pendant son absence", async ({ page }) => {
  await connecter(page, "VT0003");
  page.on("dialog", (boite) => boite.accept());
  await page.locator('[data-route="/validation"]').first().click();
  await expect(page.getByRole("heading", { name: "Mon remplaçant" })).toBeVisible();
  await expect(page.getByText("Aucun remplaçant en fonction")).toBeVisible();

  await page.locator("#deleg-declarer").click();
  const formulaire = page.locator("#form-delegation");
  const collegue = await formulaire.locator('[name="suppleant"] option').filter({ hasText: "VT0010" }).getAttribute("value");
  await formulaire.locator('[name="suppleant"]').selectOption(collegue);
  const jour = (decalage) => new Date(Date.now() + decalage * 86400000).toISOString().slice(0, 10);
  await formulaire.locator('[name="debut"]').fill(jour(0));
  await formulaire.locator('[name="fin"]').fill(jour(5));
  await formulaire.locator('[name="motif"]').fill("Congé annuel");
  await formulaire.locator('button[type="submit"]').click();

  const bandeau = page.locator(".bandeau-info");
  await expect(bandeau).toContainText("décide à votre place");
  await bandeau.locator("[data-deleg-annuler]").click();
  await expect(page.getByText("Aucun remplaçant en fonction")).toBeVisible();
});
