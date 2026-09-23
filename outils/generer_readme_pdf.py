"""Produit un PDF à partir d'un fichier Markdown du projet (README.md par défaut).

Gère le sous-ensemble de Markdown utilisé par la documentation : titres,
paragraphes, listes, tableaux, blocs de code, séparateurs, gras, code en ligne
et liens.

Usage :  python outils/generer_readme_pdf.py [SOURCE.md [SORTIE.pdf]]
Exemple : python outils/generer_readme_pdf.py GUIDE_UTILISATION.md
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable, Image, ListFlowable, ListItem, Paragraph, Preformatted, SimpleDocTemplate, Spacer, Table, TableStyle,
)

RACINE = Path(__file__).resolve().parent.parent
SOURCE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else RACINE / "README.md"
SORTIE = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else SOURCE.with_suffix(".pdf")
LOGO = RACINE / "assets" / "marque" / "logo-clair.png"
MARINE = colors.HexColor("#072241")
ROUGE = colors.HexColor("#D92D20")
GRIS = colors.HexColor("#4A4E56")
FOND = colors.HexColor("#F0F3F9")
TRAIT = colors.HexColor("#DCE2EC")


def polices() -> tuple[str, str, str]:
    """Polices Windows couvrant Σ, →, œ… ; Helvetica à défaut."""
    dossier = Path("C:/Windows/Fonts")
    jeux = [("segoeui.ttf", "segoeuib.ttf"), ("arial.ttf", "arialbd.ttf")]
    for normal, gras in jeux:
        if (dossier / normal).exists() and (dossier / gras).exists():
            pdfmetrics.registerFont(TTFont("Texte", str(dossier / normal)))
            pdfmetrics.registerFont(TTFont("Texte-Gras", str(dossier / gras)))
            pdfmetrics.registerFontFamily("Texte", normal="Texte", bold="Texte-Gras", italic="Texte", boldItalic="Texte-Gras")
            mono = "Courier"
            if (dossier / "consola.ttf").exists():
                pdfmetrics.registerFont(TTFont("Mono", str(dossier / "consola.ttf")))
                mono = "Mono"
            return "Texte", "Texte-Gras", mono
    return "Helvetica", "Helvetica-Bold", "Courier"


TEXTE, GRAS, MONO = polices()
STYLES = {
    "h1": ParagraphStyle("h1", fontName=GRAS, fontSize=20, leading=25, textColor=MARINE, spaceAfter=6),
    "h2": ParagraphStyle("h2", fontName=GRAS, fontSize=14.5, leading=19, textColor=MARINE, spaceBefore=10, spaceAfter=5),
    "h3": ParagraphStyle("h3", fontName=GRAS, fontSize=11.5, leading=15, textColor=MARINE, spaceBefore=7, spaceAfter=3),
    "p": ParagraphStyle("p", fontName=TEXTE, fontSize=9.5, leading=13.5, textColor=GRIS, spaceAfter=5, alignment=TA_LEFT),
    "cell": ParagraphStyle("cell", fontName=TEXTE, fontSize=8.5, leading=11, textColor=GRIS),
    "cellh": ParagraphStyle("cellh", fontName=GRAS, fontSize=8.5, leading=11, textColor=colors.white),
    "code": ParagraphStyle("code", fontName=MONO, fontSize=8.5, leading=11, textColor=MARINE, backColor=FOND,
                           borderPadding=6, spaceBefore=3, spaceAfter=8, leftIndent=4),
}
for titre in ("h1", "h2", "h3"):
    STYLES[titre].keepWithNext = True


def en_ligne(texte: str) -> str:
    """Gras, code et liens Markdown → balises ReportLab (texte échappé)."""
    # Les polices du poste ne couvrent pas toujours les coches emoji.
    texte = texte.replace("✅", "Oui")
    texte = texte.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    texte = re.sub(r"`([^`]+)`", lambda m: f'<font face="{MONO}" color="#072241">{m.group(1)}</font>', texte)
    texte = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", texte)
    texte = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<link href="\2" color="#2E72C0">\1</link>', texte)
    texte = re.sub(r"(?<![\"=>])(https?://[^\s<)]+)", r'<link href="\1" color="#2E72C0">\1</link>', texte)
    return texte


def tableau(lignes: list[str], largeur: float) -> Table:
    cellules = [[c.strip() for c in l.strip().strip("|").split("|")] for l in lignes if not re.match(r"^\|\s*-", l)]
    donnees = [[Paragraph(en_ligne(c), STYLES["cellh" if i == 0 else "cell"]) for c in ligne] for i, ligne in enumerate(cellules)]
    t = Table(donnees, colWidths=[largeur / len(cellules[0])] * len(cellules[0]), repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), MARINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, FOND]),
        ("GRID", (0, 0), (-1, -1), 0.4, TRAIT),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def construire(markdown: str, largeur: float) -> list:
    elements: list = []
    lignes = markdown.splitlines()
    i = 0
    paragraphe: list[str] = []

    def vider():
        if paragraphe:
            elements.append(Paragraph(en_ligne(" ".join(paragraphe)), STYLES["p"]))
            paragraphe.clear()

    while i < len(lignes):
        ligne = lignes[i]
        brut = ligne.strip()
        if brut.startswith("```"):
            vider()
            bloc = []
            i += 1
            while i < len(lignes) and not lignes[i].strip().startswith("```"):
                bloc.append(lignes[i]); i += 1
            elements.append(Preformatted("\n".join(bloc), STYLES["code"]))
        elif brut.startswith("#"):
            vider()
            niveau = min(3, len(brut) - len(brut.lstrip("#")))
            elements.append(Paragraph(en_ligne(brut.lstrip("#").strip()), STYLES[f"h{niveau}"]))
            if niveau == 1:
                elements.append(HRFlowable(width="100%", thickness=2, color=ROUGE, spaceAfter=8))
        elif brut == "---":
            vider()
            elements.append(HRFlowable(width="100%", thickness=0.6, color=TRAIT, spaceBefore=4, spaceAfter=4))
        elif brut.startswith("|"):
            vider()
            bloc = []
            while i < len(lignes) and lignes[i].strip().startswith("|"):
                bloc.append(lignes[i]); i += 1
            elements.append(tableau(bloc, largeur))
            elements.append(Spacer(1, 6))
            continue
        elif re.match(r"^(\s*)([-*]|\d+\.)\s+", ligne):
            vider()
            numerote = bool(re.match(r"^\s*\d+\.", ligne))
            items = []
            while i < len(lignes) and (re.match(r"^\s*([-*]|\d+\.)\s+", lignes[i]) or
                                       (lignes[i].startswith("  ") and lignes[i].strip() and items)):
                if re.match(r"^\s*([-*]|\d+\.)\s+", lignes[i]):
                    items.append(re.sub(r"^\s*([-*]|\d+\.)\s+", "", lignes[i]))
                else:
                    items[-1] += " " + lignes[i].strip()
                i += 1
            elements.append(ListFlowable(
                [ListItem(Paragraph(en_ligne(t), STYLES["p"]), leftIndent=12) for t in items],
                bulletType="1" if numerote else "bullet", start="1" if numerote else None,
                bulletFontName=TEXTE, bulletFontSize=9, bulletColor=ROUGE, leftIndent=14))
            continue
        elif not brut:
            vider()
        else:
            paragraphe.append(brut)
        i += 1
    vider()
    return elements


def pied(canvas, doc):
    canvas.saveState()
    canvas.setFont(TEXTE, 7.5)
    canvas.setFillColor(GRIS)
    canvas.drawString(18 * mm, 10 * mm, "Portail RH — Veltaris · données fictives de démonstration")
    canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Page {doc.page}")
    canvas.restoreState()


def _titre() -> str:
    """Premier titre du document, sinon le nom du fichier."""
    for ligne in SOURCE.read_text(encoding="utf-8").splitlines():
        if ligne.startswith("# "):
            return ligne[2:].strip()
    return SOURCE.stem


def main() -> None:
    doc = SimpleDocTemplate(str(SORTIE), pagesize=A4, invariant=True, leftMargin=18 * mm, rightMargin=18 * mm,
                            topMargin=16 * mm, bottomMargin=18 * mm,
                            title=_titre(), author="Portail RH", subject="Portail RH — Veltaris")
    largeur = A4[0] - 36 * mm
    elements = []
    if LOGO.exists():
        largeur_logo, hauteur_logo = ImageReader(str(LOGO)).getSize()
        logo = Image(str(LOGO), width=46 * mm, height=46 * mm * hauteur_logo / largeur_logo)
        logo.hAlign = "LEFT"
        elements += [logo, Spacer(1, 8)]
    elements += construire(SOURCE.read_text(encoding="utf-8"), largeur)
    doc.build(elements, onFirstPage=pied, onLaterPages=pied)
    print(f"{SORTIE.name} généré ({SORTIE.stat().st_size // 1024} Ko)")


if __name__ == "__main__":
    main()
