"""Modèles de documents Veltaris — PDF (ReportLab) et Excel (openpyxl).

Chaque document produit par la plateforme partage la même charpente :
logotype officiel, titre, date et auteur de l'édition, contenu, cadre
d'observations, zones de signature et de cachet, pied de page paginé.
Les couleurs sont celles de la charte de l'application.
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from openpyxl import Workbook
from openpyxl.drawing.image import Image as ImageExcel
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

RACINE = Path(__file__).resolve().parents[3]
LOGO = RACINE / "assets" / "marque" / "logo-clair.png"
RATIO_LOGO = 412 / 120  # largeur / hauteur du logotype

# Charte Veltaris
MARINE = colors.HexColor("#072241")
ROUGE = colors.HexColor("#D92D20")
GRIS_TEXTE = colors.HexColor("#4A4E56")
GRIS_DOUX = colors.HexColor("#7C8CA3")
FOND_DOUX = colors.HexColor("#F0F3F9")
FOND_LIGNE = colors.HexColor("#F7F9FC")
TRAIT = colors.HexColor("#DCE2EC")

HEX_MARINE, HEX_ROUGE, HEX_FOND, HEX_ZEBRE, HEX_TRAIT = "072241", "DF271C", "F0F3F9", "F7F9FC", "DCE2EC"


@dataclass
class EnteteDocument:
    titre: str
    sous_titre: str = ""
    reference: str | None = None
    edite_par: str | None = None
    edite_le: datetime = field(default_factory=datetime.now)

    @property
    def mention_edition(self) -> str:
        texte = f"Édité le {self.edite_le:%d/%m/%Y à %H:%M}"
        if self.edite_par:
            texte += f" par {self.edite_par}"
        return texte


# =============================================================================
#   PDF
# =============================================================================
STYLES = {
    "titre": ParagraphStyle("titre", fontName="Helvetica-Bold", fontSize=20, leading=24, textColor=MARINE, spaceAfter=3),
    "sous_titre": ParagraphStyle("sous_titre", fontName="Helvetica", fontSize=10.5, leading=14, textColor=GRIS_TEXTE),
    "meta": ParagraphStyle("meta", fontName="Helvetica", fontSize=8.5, leading=11, textColor=GRIS_DOUX),
    "section": ParagraphStyle("section", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=ROUGE,
                              spaceBefore=4, spaceAfter=6),
    "cle": ParagraphStyle("cle", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=MARINE),
    "valeur": ParagraphStyle("valeur", fontName="Helvetica", fontSize=9.5, leading=13, textColor=colors.black),
    "entete_tableau": ParagraphStyle("entete_tableau", fontName="Helvetica-Bold", fontSize=8.5, leading=11,
                                     textColor=colors.white),
    "cellule": ParagraphStyle("cellule", fontName="Helvetica", fontSize=8.5, leading=11, textColor=colors.black),
    "texte": ParagraphStyle("texte", fontName="Helvetica", fontSize=9.5, leading=14, textColor=GRIS_TEXTE),
    "cadre_titre": ParagraphStyle("cadre_titre", fontName="Helvetica-Bold", fontSize=8.5, leading=11, textColor=MARINE),
    "cadre_ligne": ParagraphStyle("cadre_ligne", fontName="Helvetica", fontSize=8, leading=16, textColor=GRIS_DOUX),
}

MARGE = 18 * mm
LARGEUR_UTILE = A4[0] - 2 * MARGE


def _dessiner_cadre_page(canvas, doc, entete: EnteteDocument) -> None:
    """En-tête et pied de page, répétés sur chaque page."""
    largeur, hauteur = A4
    canvas.saveState()

    # Logotype officiel en haut à gauche
    hauteur_logo = 7.2 * mm
    if LOGO.exists():
        canvas.drawImage(str(LOGO), MARGE, hauteur - 15 * mm - hauteur_logo,
                         width=hauteur_logo * RATIO_LOGO, height=hauteur_logo, mask="auto")

    # Libellé du service à droite
    canvas.setFillColor(MARINE)
    canvas.setFont("Helvetica-Bold", 8.5)
    canvas.drawRightString(largeur - MARGE, hauteur - 17 * mm, "DIRECTION DES RESSOURCES HUMAINES")
    canvas.setFillColor(GRIS_DOUX)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawRightString(largeur - MARGE, hauteur - 21 * mm, "Portail RH — document officiel")

    # Filet rouge de la charte, doublé d'un trait marine fin
    canvas.setFillColor(ROUGE)
    canvas.rect(MARGE, hauteur - 27 * mm, 26 * mm, 1.3 * mm, stroke=0, fill=1)
    canvas.setStrokeColor(TRAIT)
    canvas.setLineWidth(0.6)
    canvas.line(MARGE + 27 * mm, hauteur - 26.35 * mm, largeur - MARGE, hauteur - 26.35 * mm)

    # Pied de page
    canvas.setStrokeColor(TRAIT)
    canvas.line(MARGE, 16 * mm, largeur - MARGE, 16 * mm)
    canvas.setFont("Helvetica-Bold", 7.5)
    canvas.setFillColor(MARINE)
    canvas.drawString(MARGE, 11.5 * mm, "VELTARIS")
    decalage = canvas.stringWidth("VELTARIS", "Helvetica-Bold", 7.5) + 5
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(GRIS_DOUX)
    canvas.drawString(MARGE + decalage, 11.5 * mm, f"·   {entete.mention_edition}")
    reference = f"Réf. {entete.reference}  ·  " if entete.reference else ""
    canvas.drawRightString(largeur - MARGE, 11.5 * mm, f"{reference}Page {doc.page}")

    canvas.restoreState()


def _bloc_titre(entete: EnteteDocument) -> list:
    elements = [Paragraph(entete.titre, STYLES["titre"])]
    if entete.sous_titre:
        elements.append(Paragraph(entete.sous_titre, STYLES["sous_titre"]))
    elements.append(Spacer(1, 3 * mm))

    puces = [entete.mention_edition]
    if entete.reference:
        puces.insert(0, f"Référence {entete.reference}")
    bandeau = Table(
        [[Paragraph("  ·  ".join(puces), STYLES["meta"])]],
        colWidths=[LARGEUR_UTILE],
    )
    bandeau.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), FOND_DOUX),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LINEBEFORE", (0, 0), (0, -1), 2.2, ROUGE),
    ]))
    elements += [bandeau, Spacer(1, 7 * mm)]
    return elements


def fiche_cle_valeur(lignes: list[tuple[str, str]], titre_section: str | None = None) -> list:
    """Bloc « libellé / valeur » à lignes alternées."""
    elements = []
    if titre_section:
        elements.append(Paragraph(titre_section.upper(), STYLES["section"]))
    donnees = [[Paragraph(cle, STYLES["cle"]), Paragraph(str(valeur), STYLES["valeur"])] for cle, valeur in lignes]
    table = Table(donnees, colWidths=[52 * mm, LARGEUR_UTILE - 52 * mm])
    style = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, TRAIT),
        ("BOX", (0, 0), (-1, -1), 0.6, TRAIT),
    ]
    for index in range(len(donnees)):
        if index % 2 == 0:
            style.append(("BACKGROUND", (0, index), (-1, index), FOND_LIGNE))
    table.setStyle(TableStyle(style))
    elements += [table, Spacer(1, 6 * mm)]
    return elements


def tableau_donnees(entetes: list[str], lignes: list[list], largeurs: list[float] | None = None,
                    titre_section: str | None = None) -> list:
    """Tableau de données avec en-tête marine, lignes zébrées, répété à chaque page."""
    elements = []
    if titre_section:
        elements.append(Paragraph(titre_section.upper(), STYLES["section"]))
    donnees = [[Paragraph(e, STYLES["entete_tableau"]) for e in entetes]]
    donnees += [[Paragraph(str(v), STYLES["cellule"]) for v in ligne] for ligne in lignes]
    if largeurs is None:
        largeurs = [LARGEUR_UTILE / len(entetes)] * len(entetes)
    table = Table(donnees, colWidths=largeurs, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), MARINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, TRAIT),
        ("BOX", (0, 0), (-1, -1), 0.6, TRAIT),
    ]
    for index in range(1, len(donnees)):
        if index % 2 == 0:
            style.append(("BACKGROUND", (0, index), (-1, index), FOND_LIGNE))
    table.setStyle(TableStyle(style))
    elements += [table, Spacer(1, 6 * mm)]
    return elements


def paragraphe(texte: str) -> list:
    return [Paragraph(texte, STYLES["texte"]), Spacer(1, 5 * mm)]


def _cadre_observations(observation: str | None, hauteur: float = 30 * mm) -> Table:
    contenu = [Paragraph("OBSERVATIONS", STYLES["cadre_titre"])]
    if observation:
        contenu.append(Spacer(1, 2 * mm))
        contenu.append(Paragraph(observation, STYLES["texte"]))
    else:
        # Lignes pointillées à compléter à la main
        largeur_point = pdfmetrics.stringWidth(".", "Helvetica", 8)
        nombre = int((LARGEUR_UTILE - 20) / largeur_point)
        contenu += [Paragraph("." * nombre, STYLES["cadre_ligne"]) for _ in range(3)]
    cadre = Table([[contenu]], colWidths=[LARGEUR_UTILE], rowHeights=[hauteur])
    cadre.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.7, TRAIT),
        ("BACKGROUND", (0, 0), (-1, -1), FOND_LIGNE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
    ]))
    return cadre


def _cadres_signature(signataire: str | None, hauteur: float = 40 * mm) -> Table:
    moitie = (LARGEUR_UTILE - 6 * mm) / 2

    def zone(titre: str, lignes: list[str]) -> list:
        return [Paragraph(titre, STYLES["cadre_titre"]), Spacer(1, 1.5 * mm)] + [
            Paragraph(ligne, STYLES["cadre_ligne"]) for ligne in lignes
        ]

    signature = zone("SIGNATURE DU RESPONSABLE", [
        f"Nom et fonction : {signataire}" if signataire else "Nom et fonction : ..............................",
        "Date : ...... / ...... / ............",
    ])
    cachet = zone("CACHET DE L'ENTREPRISE", ["Veltaris — Direction des Ressources Humaines"])

    table = Table([[signature, "", cachet]], colWidths=[moitie, 6 * mm, moitie], rowHeights=[hauteur])
    table.setStyle(TableStyle([
        ("BOX", (0, 0), (0, 0), 0.7, MARINE),
        ("BOX", (2, 0), (2, 0), 0.7, MARINE),
        ("LINEABOVE", (0, 0), (0, 0), 2.2, MARINE),
        ("LINEABOVE", (2, 0), (2, 0), 2.2, ROUGE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
    ]))
    return table


def generer_pdf(entete: EnteteDocument, contenu: list, observation: str | None = None,
                signataire: str | None = None, compact: bool = False) -> io.BytesIO:
    """Assemble un PDF complet à partir du contenu fourni. ``compact`` resserre
    les cadres d'observations et de signature (documents tenant sur une page)."""
    tampon = io.BytesIO()
    document = SimpleDocTemplate(
        tampon, pagesize=A4, title=entete.titre, author="Veltaris — Direction des RH",
        leftMargin=MARGE, rightMargin=MARGE, topMargin=34 * mm, bottomMargin=22 * mm,
    )
    elements = _bloc_titre(entete) + contenu
    elements.append(KeepTogether([
        _cadre_observations(observation, 16 * mm if compact else 30 * mm),
        Spacer(1, 4 * mm if compact else 6 * mm),
        _cadres_signature(signataire, 30 * mm if compact else 40 * mm),
    ]))
    habillage = lambda canvas, doc: _dessiner_cadre_page(canvas, doc, entete)  # noqa: E731
    document.build(elements, onFirstPage=habillage, onLaterPages=habillage)
    tampon.seek(0)
    return tampon


# =============================================================================
#   EXCEL
# =============================================================================
BORD = Side(style="thin", color=HEX_TRAIT)
BORD_FORT = Side(style="medium", color=HEX_MARINE)


def generer_excel(entete: EnteteDocument, colonnes: list[tuple[str, int]], lignes: list[list],
                  nom_feuille: str = "Données", colonne_statut: int | None = None,
                  couleurs_statut: dict[str, str] | None = None) -> io.BytesIO:
    """Classeur habillé : logotype, titre, date d'édition, tableau filtrable,
    puis cadres observations / signature / cachet sous les données."""
    classeur = Workbook()
    feuille = classeur.active
    feuille.title = nom_feuille[:31]
    nb = len(colonnes)
    derniere = get_column_letter(nb)

    for index, (_, largeur) in enumerate(colonnes, start=1):
        feuille.column_dimensions[get_column_letter(index)].width = largeur

    # --- En-tête : logotype + titre ---------------------------------------
    feuille.row_dimensions[1].height = 34
    feuille.row_dimensions[2].height = 18
    if LOGO.exists():
        logo = ImageExcel(str(LOGO))
        logo.height = 30
        logo.width = int(30 * RATIO_LOGO)
        feuille.add_image(logo, "A1")

    colonne_titre = min(4, nb)
    feuille.merge_cells(start_row=1, start_column=colonne_titre, end_row=1, end_column=nb)
    titre = feuille.cell(row=1, column=colonne_titre, value=entete.titre)
    titre.font = Font(name="Calibri", size=16, bold=True, color=HEX_MARINE)
    titre.alignment = Alignment(horizontal="right", vertical="center")

    feuille.merge_cells(start_row=2, start_column=colonne_titre, end_row=2, end_column=nb)
    edition = feuille.cell(row=2, column=colonne_titre,
                           value=f"{entete.sous_titre}  ·  {entete.mention_edition}" if entete.sous_titre
                           else entete.mention_edition)
    edition.font = Font(name="Calibri", size=9.5, italic=True, color="7C8CA3")
    edition.alignment = Alignment(horizontal="right", vertical="center")

    # Filet de charte : amorce rouge puis trait marine
    for colonne in range(1, nb + 1):
        cellule = feuille.cell(row=3, column=colonne)
        cellule.border = Border(bottom=Side(style="thick", color=HEX_ROUGE if colonne <= 2 else HEX_MARINE))
    feuille.row_dimensions[3].height = 6

    # --- Tableau -------------------------------------------------------------
    ligne_entete = 5
    feuille.row_dimensions[ligne_entete].height = 24
    for index, (libelle, _) in enumerate(colonnes, start=1):
        cellule = feuille.cell(row=ligne_entete, column=index, value=libelle)
        cellule.font = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
        cellule.fill = PatternFill("solid", fgColor=HEX_MARINE)
        cellule.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cellule.border = Border(left=BORD, right=BORD, top=BORD, bottom=BORD)

    for decalage, valeurs in enumerate(lignes, start=1):
        rang = ligne_entete + decalage
        feuille.row_dimensions[rang].height = 18
        for index, valeur in enumerate(valeurs, start=1):
            cellule = feuille.cell(row=rang, column=index, value=valeur)
            cellule.font = Font(name="Calibri", size=10, color="1F2937")
            cellule.alignment = Alignment(horizontal="left" if index <= 3 else "center", vertical="center")
            cellule.border = Border(left=BORD, right=BORD, top=BORD, bottom=BORD)
            if decalage % 2 == 0:
                cellule.fill = PatternFill("solid", fgColor=HEX_ZEBRE)
            if colonne_statut and index == colonne_statut and couleurs_statut:
                teinte = couleurs_statut.get(str(valeur))
                if teinte:
                    cellule.fill = PatternFill("solid", fgColor=teinte)
                    cellule.font = Font(name="Calibri", size=10, bold=True, color="1F2937")

    fin_donnees = ligne_entete + max(len(lignes), 1)
    feuille.auto_filter.ref = f"A{ligne_entete}:{derniere}{fin_donnees}"
    feuille.freeze_panes = f"A{ligne_entete + 1}"

    # Ligne de synthèse
    total = feuille.cell(row=fin_donnees + 1, column=1, value=f"{len(lignes)} ligne(s)")
    total.font = Font(name="Calibri", size=9, italic=True, color="7C8CA3")

    # --- Cadres observations, signature, cachet ------------------------------
    debut = fin_donnees + 3
    _cadre_excel(feuille, debut, 1, debut + 3, nb, "OBSERVATIONS", HEX_MARINE, fond=HEX_ZEBRE)

    moitie = max(1, nb // 2)
    debut_signature = debut + 5
    _cadre_excel(feuille, debut_signature, 1, debut_signature + 5, moitie,
                 "SIGNATURE DU RESPONSABLE\nNom et fonction :\nDate :", HEX_MARINE)
    _cadre_excel(feuille, debut_signature, moitie + 1, debut_signature + 5, nb,
                 "CACHET DE L'ENTREPRISE\nVeltaris — Direction des Ressources Humaines", HEX_ROUGE)

    # --- Mise en page d'impression -----------------------------------------
    feuille.page_setup.orientation = "landscape" if nb > 6 else "portrait"
    feuille.page_setup.paperSize = feuille.PAPERSIZE_A4
    feuille.page_setup.fitToWidth = 1
    feuille.page_setup.fitToHeight = 0
    feuille.sheet_properties.pageSetUpPr.fitToPage = True
    feuille.print_title_rows = f"{ligne_entete}:{ligne_entete}"
    feuille.oddFooter.left.text = "Veltaris — Direction des Ressources Humaines"
    feuille.oddFooter.left.size = 8
    feuille.oddFooter.right.text = "Page &P / &N"
    feuille.oddFooter.right.size = 8
    feuille.sheet_view.showGridLines = False

    tampon = io.BytesIO()
    classeur.save(tampon)
    tampon.seek(0)
    return tampon


def _cadre_excel(feuille, ligne1: int, colonne1: int, ligne2: int, colonne2: int,
                 texte: str, couleur_bord: str, fond: str | None = None) -> None:
    feuille.merge_cells(start_row=ligne1, start_column=colonne1, end_row=ligne2, end_column=colonne2)
    cellule = feuille.cell(row=ligne1, column=colonne1, value=texte)
    cellule.font = Font(name="Calibri", size=10, bold=True, color=HEX_MARINE)
    cellule.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
    cote = Side(style="thin", color=HEX_TRAIT)
    haut = Side(style="thick", color=couleur_bord)
    for rang in range(ligne1, ligne2 + 1):
        for colonne in range(colonne1, colonne2 + 1):
            case = feuille.cell(row=rang, column=colonne)
            case.border = Border(
                left=cote if colonne == colonne1 else None,
                right=cote if colonne == colonne2 else None,
                top=haut if rang == ligne1 else None,
                bottom=cote if rang == ligne2 else None,
            )
            if fond:
                case.fill = PatternFill("solid", fgColor=fond)


# =============================================================================
#   VÉRIFICATION D'AUTHENTICITÉ (générateur de documents)
# =============================================================================
def bloc_verification(adresse: str, numero: str, code: str) -> list:
    """QR code et mentions de vérification, en fin de document."""
    from reportlab.graphics.barcode.qr import QrCodeWidget
    from reportlab.graphics.shapes import Drawing

    cote = 26 * mm
    widget = QrCodeWidget(adresse)
    x1, y1, x2, y2 = widget.getBounds()
    dessin = Drawing(cote, cote, transform=[cote / (x2 - x1), 0, 0, cote / (y2 - y1), 0, 0])
    dessin.add(widget)
    texte = [
        Paragraph("AUTHENTICITÉ DU DOCUMENT", STYLES["cadre_titre"]),
        Spacer(1, 1.5 * mm),
        Paragraph(f"Document n° <b>{numero}</b> — code de vérification <b>{code}</b>", STYLES["texte"]),
        Paragraph("Scannez le QR code ou saisissez le code dans le portail RH de Veltaris pour vérifier que "
                  "ce document a bien été émis par la Direction des Ressources Humaines et qu'il n'a pas été annulé.",
                  STYLES["meta"]),
    ]
    table = Table([[dessin, texte]], colWidths=[cote + 6 * mm, LARGEUR_UTILE - cote - 6 * mm])
    table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.7, TRAIT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return [Spacer(1, 3 * mm), table, Spacer(1, 5 * mm)]
