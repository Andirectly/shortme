# Einmaliges Entwickler-Werkzeug: statische Fett-Schnitte aus den variablen Google-Fonts-Dateien erzeugen
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
src = '.tmp/fonts-dl/gf/'
out = 'resources/fonts/'
def inst(infile, outfile, axes, family, style):
    f = TTFont(src + infile)
    g = instantiateVariableFont(f, axes, updateFontNames=False)
    name = g['name']
    for rec in list(name.names):
        if rec.nameID in (1, 16): rec.string = family
        elif rec.nameID in (2, 17): rec.string = style
        elif rec.nameID == 4: rec.string = family + ' ' + style
        elif rec.nameID == 6: rec.string = (family + '-' + style).replace(' ', '')
    g['OS/2'].usWeightClass = axes.get('wght', 700)
    g.save(out + outfile)
    print(outfile, family, style)
inst('Montserrat-VF.ttf', 'Montserrat-ExtraBold.ttf', {'wght': 800}, 'Montserrat', 'ExtraBold')
inst('Inter-VF.ttf', 'Inter-Bold.ttf', {'wght': 700, 'opsz': 28}, 'Inter', 'Bold')
