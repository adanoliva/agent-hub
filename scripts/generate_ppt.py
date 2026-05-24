"""
Genera Agent Hub presentation PPT desde docs/presentacion.md
Paleta: fondo #0d0d0f · acento #7c6af7 · texto #f0f0f5
"""

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt
import copy

# ── Colores ──────────────────────────────────────────────────────────────────
BG     = RGBColor(0x0d, 0x0d, 0x0f)
ACCENT = RGBColor(0x7c, 0x6a, 0xf7)
TEXT0  = RGBColor(0xf0, 0xf0, 0xf5)
TEXT2  = RGBColor(0x9d, 0x9d, 0xb5)
TEXT3  = RGBColor(0x5a, 0x5a, 0x75)
GREEN  = RGBColor(0x3e, 0xcf, 0x8e)
AMBER  = RGBColor(0xf5, 0x9e, 0x0b)
CORAL  = RGBColor(0xff, 0x6b, 0x6b)
WHITE  = RGBColor(0xff, 0xff, 0xff)

W = Inches(13.33)   # widescreen 16:9
H = Inches(7.5)

FONT_TITLE = "Syne"
FONT_BODY  = "Syne"
FONT_MONO  = "JetBrains Mono"


# ── Helpers ───────────────────────────────────────────────────────────────────

def new_prs():
    prs = Presentation()
    prs.slide_width  = W
    prs.slide_height = H
    return prs

def blank_slide(prs):
    layout = prs.slide_layouts[6]  # completamente en blanco
    return prs.slides.add_slide(layout)

def bg(slide, color=BG):
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = color

def txbox(slide, x, y, w, h):
    return slide.shapes.add_textbox(x, y, w, h)

def para(tf, text, size, bold=False, color=TEXT0, font=FONT_BODY, align=PP_ALIGN.LEFT, space_before=0):
    p = tf.add_paragraph()
    p.alignment = align
    p.space_before = Pt(space_before)
    run = p.add_run()
    run.text = text
    run.font.name = font
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    return p

def label_chip(slide, text, x, y):
    """Pequeña etiqueta violeta estilo 'section-label'."""
    tb = txbox(slide, x, y, Inches(4), Inches(0.35))
    tf = tb.text_frame
    tf.word_wrap = False
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.LEFT
    run = p.add_run()
    run.text = text.upper()
    run.font.name = FONT_BODY
    run.font.size = Pt(10)
    run.font.bold = True
    run.font.color.rgb = ACCENT

def rect(slide, x, y, w, h, fill_color, alpha=None):
    shape = slide.shapes.add_shape(
        1,  # MSO_SHAPE_TYPE.RECTANGLE
        x, y, w, h
    )
    shape.line.fill.background()
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill_color
    return shape

def accent_line(slide, x, y, w=Inches(0.5), h=Inches(0.04)):
    r = rect(slide, x, y, w, h, ACCENT)
    return r

def checkmark_list(slide, items, x, y, w, size=14, gap=0.42):
    """Lista con checkmarks verdes."""
    tb = txbox(slide, x, y, w, Inches(len(items) * gap + 0.2))
    tf = tb.text_frame
    tf.word_wrap = True
    first = True
    for item in items:
        if first:
            p = tf.paragraphs[0]
            first = False
        else:
            p = tf.add_paragraph()
        p.space_before = Pt(4)
        run = p.add_run()
        run.text = "✓  " + item
        run.font.name = FONT_BODY
        run.font.size = Pt(size)
        run.font.color.rgb = GREEN

def bullet_list(slide, items, x, y, w, size=15, color=TEXT2, gap=0.45, bullet="—"):
    tb = txbox(slide, x, y, w, Inches(len(items) * gap + 0.2))
    tf = tb.text_frame
    tf.word_wrap = True
    first = True
    for item in items:
        if first:
            p = tf.paragraphs[0]
            first = False
        else:
            p = tf.add_paragraph()
        p.space_before = Pt(4)
        run = p.add_run()
        run.text = f"{bullet}  {item}"
        run.font.name = FONT_BODY
        run.font.size = Pt(size)
        run.font.color.rgb = color

def divider(slide, y):
    rect(slide, Inches(1), y, Inches(11.33), Inches(0.01), TEXT3)


# ── SLIDES ────────────────────────────────────────────────────────────────────

def slide_01_cover(prs):
    s = blank_slide(prs)
    bg(s)

    # Fondo degradado simulado con rectángulos superpuestos (violeta difuso arriba)
    r = rect(s, Inches(0), Inches(0), W, Inches(3.5), RGBColor(0x1a, 0x14, 0x3d))

    # Logo text
    tb = txbox(s, Inches(1), Inches(0.6), Inches(4), Inches(0.6))
    tf = tb.text_frame
    p = tf.paragraphs[0]
    run = p.add_run()
    run.text = "Agent Hub"
    run.font.name = FONT_TITLE
    run.font.size = Pt(18)
    run.font.bold = True
    run.font.color.rgb = ACCENT

    # Título grande
    tb = txbox(s, Inches(1.5), Inches(1.6), Inches(10.3), Inches(1.8))
    tf = tb.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    run = p.add_run()
    run.text = "Gestiona tus agentes de IA"
    run.font.name = FONT_TITLE
    run.font.size = Pt(46)
    run.font.bold = True
    run.font.color.rgb = TEXT0

    p2 = tf.add_paragraph()
    p2.alignment = PP_ALIGN.CENTER
    run2 = p2.add_run()
    run2.text = "como un profesional"
    run2.font.name = FONT_TITLE
    run2.font.size = Pt(46)
    run2.font.bold = True
    run2.font.color.rgb = ACCENT

    # Subtítulo
    tb = txbox(s, Inches(2), Inches(3.7), Inches(9.33), Inches(0.7))
    tf = tb.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    run = p.add_run()
    run.text = "La plataforma para gestionar tus agentes de IA y proyectos de desarrollo en un solo lugar."
    run.font.name = FONT_BODY
    run.font.size = Pt(16)
    run.font.color.rgb = TEXT2

    # Tagline
    tb = txbox(s, Inches(2), Inches(4.6), Inches(9.33), Inches(0.5))
    tf = tb.text_frame
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    run = p.add_run()
    run.text = "Construida con IA · Para la IA · Con manos humanas al volante"
    run.font.name = FONT_BODY
    run.font.size = Pt(13)
    run.font.color.rgb = TEXT3
    run.font.italic = True

    # Badge versión
    badge = rect(s, Inches(5.67), Inches(5.5), Inches(2), Inches(0.42),
                 RGBColor(0x1e, 0x18, 0x4a))
    tb2 = txbox(s, Inches(5.67), Inches(5.5), Inches(2), Inches(0.42))
    tf2 = tb2.text_frame
    p2 = tf2.paragraphs[0]
    p2.alignment = PP_ALIGN.CENTER
    run2 = p2.add_run()
    run2.text = "✦  v1.8.0"
    run2.font.name = FONT_BODY
    run2.font.size = Pt(12)
    run2.font.bold = True
    run2.font.color.rgb = ACCENT


def slide_02_problem(prs):
    s = blank_slide(prs)
    bg(s)

    label_chip(s, "El problema", Inches(1), Inches(0.55))

    tb = txbox(s, Inches(1), Inches(1.0), Inches(11.33), Inches(0.8))
    tf = tb.text_frame
    p = tf.paragraphs[0]
    run = p.add_run()
    run.text = "Desarrollar con IA hoy es caótico"
    run.font.name = FONT_TITLE
    run.font.size = Pt(34)
    run.font.bold = True
    run.font.color.rgb = TEXT0

    problems = [
        ("Los agentes se pierden",
         "Se crean manualmente, no se reutilizan y cada proyecto acaba desincronizado."),
        ("Sin organización",
         "No hay forma fácil de agrupar agentes por proyecto, tecnología o equipo."),
        ("Prompts sin base",
         "Se escriben a ojo, sin optimización ni estructura profesional de partida."),
        ("Conocimiento bloqueado",
         "El know-how de usar bien la IA queda en la cabeza de cada persona. No se comparte."),
    ]

    cols = [Inches(1), Inches(4.2), Inches(7.4), Inches(10.6)]  # 4 columnas — solo 4 items
    # Reorganizamos: 2 columnas × 2 filas
    positions = [
        (Inches(1),    Inches(2.3)),
        (Inches(4.95), Inches(2.3)),
        (Inches(1),    Inches(4.7)),
        (Inches(4.95), Inches(4.7)),
    ]
    box_w = Inches(3.6)
    box_h = Inches(1.9)

    icons = ["⚠", "📁", "✏", "💡"]
    for i, (prob, desc) in enumerate(problems):
        x, y = positions[i]
        # Card background
        card = rect(s, x - Inches(0.15), y - Inches(0.15), box_w, box_h,
                    RGBColor(0x14, 0x14, 0x1a))

        tb = txbox(s, x, y, box_w - Inches(0.3), box_h)
        tf = tb.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        run = p.add_run()
        run.text = prob
        run.font.name = FONT_TITLE
        run.font.size = Pt(15)
        run.font.bold = True
        run.font.color.rgb = CORAL

        p2 = tf.add_paragraph()
        p2.space_before = Pt(6)
        run2 = p2.add_run()
        run2.text = desc
        run2.font.name = FONT_BODY
        run2.font.size = Pt(12)
        run2.font.color.rgb = TEXT2


def slide_03_solution(prs):
    s = blank_slide(prs)
    bg(s)

    label_chip(s, "La solución", Inches(1), Inches(0.55))

    tb = txbox(s, Inches(1), Inches(1.0), Inches(11.33), Inches(0.8))
    tf = tb.text_frame
    p = tf.paragraphs[0]
    run = p.add_run()
    run.text = "Agent Hub centraliza y potencia tu ecosistema de IA"
    run.font.name = FONT_TITLE
    run.font.size = Pt(30)
    run.font.bold = True
    run.font.color.rgb = TEXT0

    pillars = [
        ("1  Organiza", "Jerarquía clara: global → categoría → tecnología → proyecto."),
        ("2  Sincroniza", "Los agentes se copian automáticamente a cada proyecto al actualizarse."),
        ("3  Genera", "System prompts profesionales con IA en segundos, sin escribir desde cero."),
    ]
    colors = [ACCENT, GREEN, AMBER]
    xs = [Inches(1), Inches(4.95), Inches(8.9)]
    for i, (title, desc) in enumerate(pillars):
        x = xs[i]
        y = Inches(2.4)
        # Línea de acento
        rect(s, x, y, Inches(0.4), Inches(0.05), colors[i])

        tb = txbox(s, x, y + Inches(0.18), Inches(3.5), Inches(2.2))
        tf = tb.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        run = p.add_run()
        run.text = title
        run.font.name = FONT_TITLE
        run.font.size = Pt(20)
        run.font.bold = True
        run.font.color.rgb = colors[i]

        p2 = tf.add_paragraph()
        p2.space_before = Pt(8)
        run2 = p2.add_run()
        run2.text = desc
        run2.font.name = FONT_BODY
        run2.font.size = Pt(14)
        run2.font.color.rgb = TEXT2

    # Diagrama simplificado de jerarquía
    levels_text = ["Global  →  Categoría  →  Tecnología  →  Proyecto"]
    tb = txbox(s, Inches(1), Inches(5.6), Inches(11.33), Inches(0.5))
    tf = tb.text_frame
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    run = p.add_run()
    run.text = "Global  →  Sección  →  Tecnología  →  Proyecto"
    run.font.name = FONT_MONO
    run.font.size = Pt(13)
    run.font.color.rgb = TEXT3


def slide_04_what_is_agent(prs):
    s = blank_slide(prs)
    bg(s)

    label_chip(s, "¿Qué es un agente?", Inches(1), Inches(0.55))

    tb = txbox(s, Inches(1), Inches(1.0), Inches(7), Inches(0.7))
    tf = tb.text_frame
    p = tf.paragraphs[0]
    run = p.add_run()
    run.text = "Instrucciones que guían a la IA"
    run.font.name = FONT_TITLE
    run.font.size = Pt(30)
    run.font.bold = True
    run.font.color.rgb = TEXT0

    tb = txbox(s, Inches(1), Inches(1.95), Inches(5.5), Inches(1.5))
    tf = tb.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    run = p.add_run()
    run.text = ("Un agente es un archivo con instrucciones que le dicen a Claude "
                "(o a Copilot) cómo debe comportarse cuando trabaja en tu proyecto. "
                "Define su rol, sus herramientas y sus reglas.")
    run.font.name = FONT_BODY
    run.font.size = Pt(14)
    run.font.color.rgb = TEXT2

    # Bloque de código
    code_bg = rect(s, Inches(7.1), Inches(1.2), Inches(5.5), Inches(5.2),
                   RGBColor(0x0a, 0x0a, 0x10))
    # Borde izquierdo acento
    rect(s, Inches(7.1), Inches(1.2), Inches(0.06), Inches(5.2), ACCENT)

    code_lines = [
        "---",
        "name: code-reviewer",
        "description: Revisor de código senior",
        "model: claude-sonnet-4-20250514",
        "tools:",
        "  - Read",
        "  - Bash",
        "  - Grep",
        "---",
        "",
        "Analiza el código buscando bugs,",
        "vulnerabilidades y oportunidades",
        "de mejora. Sé directo y específico.",
    ]
    tb = txbox(s, Inches(7.4), Inches(1.4), Inches(4.9), Inches(4.8))
    tf = tb.text_frame
    tf.word_wrap = False
    first = True
    for line in code_lines:
        if first:
            p = tf.paragraphs[0]
            first = False
        else:
            p = tf.add_paragraph()
        run = p.add_run()
        run.text = line if line else " "
        run.font.name = FONT_MONO
        run.font.size = Pt(11)
        if line.startswith("name:") or line.startswith("description:") or line.startswith("model:") or line.startswith("tools:"):
            run.font.color.rgb = ACCENT
        elif line in ("---",):
            run.font.color.rgb = TEXT3
        elif line.startswith("  -"):
            run.font.color.rgb = GREEN
        else:
            run.font.color.rgb = TEXT2

    # Tres propiedades clave (izquierda)
    props = [
        ("Rol", "Revisor de código senior"),
        ("Herramientas", "Read, Bash, Grep, Write…"),
        ("Modelo", "haiku  /  sonnet  /  opus"),
    ]
    for i, (k, v) in enumerate(props):
        y = Inches(3.7 + i * 0.85)
        tb = txbox(s, Inches(1), y, Inches(5.5), Inches(0.7))
        tf = tb.text_frame
        p = tf.paragraphs[0]
        rk = p.add_run()
        rk.text = k + "  "
        rk.font.name = FONT_BODY
        rk.font.size = Pt(13)
        rk.font.bold = True
        rk.font.color.rgb = ACCENT
        rv = p.add_run()
        rv.text = v
        rv.font.name = FONT_BODY
        rv.font.size = Pt(13)
        rv.font.color.rgb = TEXT2


def slide_05_features(prs):
    s = blank_slide(prs)
    bg(s)

    label_chip(s, "Funcionalidades", Inches(1), Inches(0.4))

    tb = txbox(s, Inches(1), Inches(0.85), Inches(11.33), Inches(0.65))
    tf = tb.text_frame
    p = tf.paragraphs[0]
    run = p.add_run()
    run.text = "Todo lo que necesitas, en una sola app"
    run.font.name = FONT_TITLE
    run.font.size = Pt(28)
    run.font.bold = True
    run.font.color.rgb = TEXT0

    features = [
        ("🗂", "Gestión de proyectos",   "Organiza por categoría y tecnología. Abre en VS Code con un clic.", False),
        ("🤖", "Editor de agentes",      "Crea y edita agentes con asistencia de IA integrada.", False),
        ("✨", "Generación con IA",       "Describe lo que necesitas y la IA escribe el prompt por ti.", True),
        ("⚡", "Ejecución directa",       "Lanza un agente sobre tu proyecto con un clic. Aplica cambios y devuelve un informe.", True),
        ("🔄", "Sync automático",         "Los agentes se sincronizan a todos los proyectos que los usan.", False),
        ("💬", "Chat integrado",          "Consulta a la IA con indicador de contexto y detección de proveedor.", False),
        ("📦", "Directorio de agentes",   "Catálogo curado de agentes profesionales, siempre actualizados.", False),
    ]

    # 4 cols × 2 filas (7 items: 4+3)
    cols = 4
    card_w = Inches(2.9)
    card_h = Inches(1.7)
    gap_x = Inches(0.18)
    gap_y = Inches(0.22)
    start_x = Inches(0.75)
    start_y = Inches(1.75)

    for i, (icon, title, desc, is_accent) in enumerate(features):
        col = i % cols
        row = i // cols
        x = start_x + col * (card_w + gap_x)
        y = start_y + row * (card_h + gap_y)

        card_color = RGBColor(0x17, 0x12, 0x35) if is_accent else RGBColor(0x14, 0x14, 0x1a)
        card = rect(s, x, y, card_w, card_h, card_color)

        if is_accent:
            rect(s, x, y, card_w, Inches(0.04), ACCENT)

        tb = txbox(s, x + Inches(0.2), y + Inches(0.15), card_w - Inches(0.3), card_h - Inches(0.2))
        tf = tb.text_frame
        tf.word_wrap = True

        p = tf.paragraphs[0]
        run = p.add_run()
        run.text = icon + "  " + title
        run.font.name = FONT_TITLE
        run.font.size = Pt(13)
        run.font.bold = True
        run.font.color.rgb = ACCENT if is_accent else TEXT0

        p2 = tf.add_paragraph()
        p2.space_before = Pt(5)
        run2 = p2.add_run()
        run2.text = desc
        run2.font.name = FONT_BODY
        run2.font.size = Pt(11)
        run2.font.color.rgb = TEXT2


def slide_06_how(prs):
    s = blank_slide(prs)
    bg(s)

    label_chip(s, "Cómo funciona", Inches(1), Inches(0.45))

    tb = txbox(s, Inches(1), Inches(0.9), Inches(11.33), Inches(0.65))
    tf = tb.text_frame
    p = tf.paragraphs[0]
    run = p.add_run()
    run.text = "De la idea al resultado en minutos"
    run.font.name = FONT_TITLE
    run.font.size = Pt(28)
    run.font.bold = True
    run.font.color.rgb = TEXT0

    steps = [
        ("01", "Describes",   "Qué necesitas en lenguaje natural"),
        ("02", "IA genera",   "System prompt completo y optimizado"),
        ("03", "Asignas",     "Al nivel adecuado: global, categoría o proyecto"),
        ("04", "Sincronizas", "La app copia el agente a todos los proyectos"),
        ("05", "Usas",        "En Claude Code o GitHub Copilot desde tu editor"),
        ("06", "Ejecutas",    "El agente actúa sobre tu proyecto y devuelve un informe"),
    ]

    step_w = Inches(2.0)
    step_h = Inches(3.2)
    gap    = Inches(0.12)
    start_x = Inches(0.55)
    y_top = Inches(2.1)

    for i, (num, title, desc) in enumerate(steps):
        x = start_x + i * (step_w + gap)
        # Número
        tb = txbox(s, x, y_top, step_w, Inches(0.45))
        tf = tb.text_frame
        p = tf.paragraphs[0]
        run = p.add_run()
        run.text = num
        run.font.name = FONT_MONO
        run.font.size = Pt(11)
        run.font.bold = True
        run.font.color.rgb = ACCENT

        # Línea bajo número
        rect(s, x, y_top + Inches(0.45), Inches(0.35), Inches(0.04), ACCENT)

        # Título
        tb2 = txbox(s, x, y_top + Inches(0.62), step_w, Inches(0.55))
        tf2 = tb2.text_frame
        p2 = tf2.paragraphs[0]
        run2 = p2.add_run()
        run2.text = title
        run2.font.name = FONT_TITLE
        run2.font.size = Pt(16)
        run2.font.bold = True
        run2.font.color.rgb = TEXT0

        # Descripción
        tb3 = txbox(s, x, y_top + Inches(1.3), step_w, Inches(1.4))
        tf3 = tb3.text_frame
        tf3.word_wrap = True
        p3 = tf3.paragraphs[0]
        run3 = p3.add_run()
        run3.text = desc
        run3.font.name = FONT_BODY
        run3.font.size = Pt(12)
        run3.font.color.rgb = TEXT2

        # Flecha entre pasos (excepto el último)
        if i < len(steps) - 1:
            arrow_x = x + step_w + Inches(0.02)
            tb_arr = txbox(s, arrow_x, y_top + Inches(0.7), Inches(0.1), Inches(0.35))
            tf_arr = tb_arr.text_frame
            p_arr = tf_arr.paragraphs[0]
            run_arr = p_arr.add_run()
            run_arr.text = "›"
            run_arr.font.size = Pt(18)
            run_arr.font.color.rgb = TEXT3


def slide_07_collab(prs):
    s = blank_slide(prs)
    bg(s)

    label_chip(s, "Repositorio colaborativo", Inches(1), Inches(0.45))

    tb = txbox(s, Inches(1), Inches(0.9), Inches(11.33), Inches(0.65))
    tf = tb.text_frame
    p = tf.paragraphs[0]
    run = p.add_run()
    run.text = "Un catálogo compartido, siempre actualizado"
    run.font.name = FONT_TITLE
    run.font.size = Pt(28)
    run.font.bold = True
    run.font.color.rgb = TEXT0

    # Diagrama hub-and-spoke (texto)
    diagram_lines = [
        "Repositorio central (GitHub)",
        "           │",
        "           │  sync automático al arrancar",
        "           ▼",
        "    Agent Hub  (cada miembro del equipo)",
        "           │",
        "           │  sync a cada proyecto",
        "           ▼",
        "  .claude/agents/  (en tu proyecto)",
    ]
    code_bg = rect(s, Inches(1), Inches(2.0), Inches(4.8), Inches(4.0),
                   RGBColor(0x0a, 0x0a, 0x10))
    rect(s, Inches(1), Inches(2.0), Inches(0.05), Inches(4.0), ACCENT)

    tb = txbox(s, Inches(1.2), Inches(2.15), Inches(4.4), Inches(3.7))
    tf = tb.text_frame
    tf.word_wrap = False
    first = True
    for line in diagram_lines:
        if first:
            p = tf.paragraphs[0]
            first = False
        else:
            p = tf.add_paragraph()
        run = p.add_run()
        run.text = line if line else " "
        run.font.name = FONT_MONO
        run.font.size = Pt(11)
        run.font.color.rgb = GREEN if "agents" in line.lower() or "github" in line.lower() else TEXT2

    # Beneficios
    benefits = [
        ("Un solo punto de verdad",
         "El equipo siempre trabaja con la misma versión de cada agente."),
        ("Actualizaciones automáticas",
         "Cuando alguien mejora un agente, todos lo reciben en el siguiente arranque."),
        ("Control de conflictos",
         "La app detecta modificaciones locales y permite elegir qué versión conservar."),
        ("Archivos .md en GitHub",
         "Versionados, auditables, sin vendor lock-in. El equipo es dueño del conocimiento."),
    ]
    for i, (title, desc) in enumerate(benefits):
        y = Inches(2.0 + i * 1.1)
        tb = txbox(s, Inches(6.4), y, Inches(6.5), Inches(0.95))
        tf = tb.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        run = p.add_run()
        run.text = "✓  " + title
        run.font.name = FONT_TITLE
        run.font.size = Pt(13)
        run.font.bold = True
        run.font.color.rgb = GREEN

        p2 = tf.add_paragraph()
        p2.space_before = Pt(3)
        run2 = p2.add_run()
        run2.text = "    " + desc
        run2.font.name = FONT_BODY
        run2.font.size = Pt(12)
        run2.font.color.rgb = TEXT2


def slide_08_compat(prs):
    s = blank_slide(prs)
    bg(s)

    label_chip(s, "Compatibilidad", Inches(1), Inches(0.45))

    tb = txbox(s, Inches(1), Inches(0.9), Inches(11.33), Inches(0.65))
    tf = tb.text_frame
    p = tf.paragraphs[0]
    run = p.add_run()
    run.text = "Funciona con tu stack actual"
    run.font.name = FONT_TITLE
    run.font.size = Pt(32)
    run.font.bold = True
    run.font.color.rgb = TEXT0

    blocks = [
        ("Providers de IA",
         ["Claude CLI — tu suscripción de Claude.ai",
          "Anthropic API — acceso directo a los modelos",
          "GitHub Copilot — compatible con tu cuenta GitHub"]),
        ("Proyectos",
         ["Cualquier lenguaje o framework",
          "Claude Code  (.claude/agents/)",
          "GitHub Copilot  (.github/agents/)"]),
        ("Distribución",
         ["App de escritorio Windows",
          "Portable .exe — sin instalación",
          "Actualizaciones automáticas"]),
    ]

    xs = [Inches(1), Inches(4.95), Inches(8.9)]
    for i, (title, items) in enumerate(blocks):
        x = xs[i]
        y = Inches(2.2)
        rect(s, x, y, Inches(0.4), Inches(0.04), ACCENT)
        tb = txbox(s, x, y + Inches(0.15), Inches(3.6), Inches(0.5))
        tf = tb.text_frame
        p = tf.paragraphs[0]
        run = p.add_run()
        run.text = title
        run.font.name = FONT_TITLE
        run.font.size = Pt(16)
        run.font.bold = True
        run.font.color.rgb = ACCENT

        bullet_list(s, items, x, y + Inches(0.75), Inches(3.6),
                    size=13, color=TEXT2, gap=0.52, bullet="—")


def slide_09_status(prs):
    s = blank_slide(prs)
    bg(s)

    label_chip(s, "Estado actual", Inches(1), Inches(0.45))

    tb = txbox(s, Inches(1), Inches(0.9), Inches(7), Inches(0.65))
    tf = tb.text_frame
    p = tf.paragraphs[0]
    run = p.add_run()
    run.text = "v1.8.0 — En uso activo"
    run.font.name = FONT_TITLE
    run.font.size = Pt(30)
    run.font.bold = True
    run.font.color.rgb = TEXT0

    done = [
        "Gestión completa de agentes en 4 niveles",
        "Sync automático a proyectos",
        "Directorio de agentes externo con versionado",
        "Chat con historial por proyecto y @mention de agentes",
        "Generación y optimización de prompts con IA",
        "Generación de CLAUDE.md / copilot-instructions con IA",
        "Dashboard con métricas y seguimiento de uso de tokens",
        "Ejecución directa de agentes sobre proyectos",
        "Validación de contexto antes de ejecutar",
        "Indicador de estado de contexto en el chat",
    ]
    checkmark_list(s, done, Inches(1), Inches(1.85), Inches(11.33),
                   size=13, gap=0.50)


def slide_10_why(prs):
    s = blank_slide(prs)
    bg(s)

    label_chip(s, "La ventaja competitiva", Inches(1), Inches(0.45))

    tb = txbox(s, Inches(1), Inches(0.9), Inches(11.33), Inches(0.65))
    tf = tb.text_frame
    p = tf.paragraphs[0]
    run = p.add_run()
    run.text = "Por qué Agent Hub"
    run.font.name = FONT_TITLE
    run.font.size = Pt(32)
    run.font.bold = True
    run.font.color.rgb = TEXT0

    pillars = [
        ("Conocimiento compartido",
         GREEN,
         ("El repositorio central garantiza que todo el equipo trabaja "
          "con los mismos agentes, en la misma versión. El know-how de "
          "usar bien la IA deja de vivir en la cabeza de una persona y "
          "pasa a ser un activo del equipo.")),
        ("Eficiencia multiplicada",
         ACCENT,
         ("Un agente mejorado en el repositorio se propaga automáticamente "
          "a todos. Un cambio, efecto global sobre todos los proyectos y "
          "todos los miembros del equipo.")),
        ("Control total",
         AMBER,
         ("Los agentes son archivos .md en GitHub. Versionados, auditables, "
          "sin vendor lock-in. El equipo es dueño de su conocimiento y puede "
          "auditarlo o mejorarlo en cualquier momento.")),
    ]

    xs = [Inches(1), Inches(4.95), Inches(8.9)]
    for i, (title, color, desc) in enumerate(pillars):
        x = xs[i]
        y = Inches(2.3)
        # Círculo de color (simulado con cuadrado pequeño)
        rect(s, x, y, Inches(0.08), Inches(1.5), color)

        tb = txbox(s, x + Inches(0.22), y, Inches(3.4), Inches(3.8))
        tf = tb.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        run = p.add_run()
        run.text = title
        run.font.name = FONT_TITLE
        run.font.size = Pt(17)
        run.font.bold = True
        run.font.color.rgb = color

        p2 = tf.add_paragraph()
        p2.space_before = Pt(10)
        run2 = p2.add_run()
        run2.text = desc
        run2.font.name = FONT_BODY
        run2.font.size = Pt(13)
        run2.font.color.rgb = TEXT2


def slide_11_close(prs):
    s = blank_slide(prs)
    bg(s)

    # Fondo superior
    rect(s, Inches(0), Inches(0), W, Inches(3), RGBColor(0x1a, 0x14, 0x3d))

    tb = txbox(s, Inches(1.5), Inches(0.7), Inches(10.33), Inches(1.0))
    tf = tb.text_frame
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    run = p.add_run()
    run.text = "Agent Hub"
    run.font.name = FONT_TITLE
    run.font.size = Pt(48)
    run.font.bold = True
    run.font.color.rgb = TEXT0

    # Frase de cierre
    tb2 = txbox(s, Inches(1.5), Inches(1.9), Inches(10.33), Inches(0.7))
    tf2 = tb2.text_frame
    p2 = tf2.paragraphs[0]
    p2.alignment = PP_ALIGN.CENTER
    run2 = p2.add_run()
    run2.text = '"No se trata de usar más IA. Se trata de usarla mejor."'
    run2.font.name = FONT_BODY
    run2.font.size = Pt(17)
    run2.font.italic = True
    run2.font.color.rgb = TEXT2

    # CTAs
    ctas = [
        "Descarga la app",
        "Prueba el directorio de agentes",
        "Empieza a trabajar con IA de forma estructurada",
    ]
    for i, cta in enumerate(ctas):
        y = Inches(3.5 + i * 0.75)
        tb = txbox(s, Inches(2.5), y, Inches(8.33), Inches(0.55))
        tf = tb.text_frame
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        run = p.add_run()
        run.text = "→  " + cta
        run.font.name = FONT_BODY
        run.font.size = Pt(15)
        run.font.color.rgb = ACCENT if i == 0 else TEXT0

    # Badge versión
    tb_v = txbox(s, Inches(5.67), Inches(6.7), Inches(2), Inches(0.42))
    tf_v = tb_v.text_frame
    p_v = tf_v.paragraphs[0]
    p_v.alignment = PP_ALIGN.CENTER
    run_v = p_v.add_run()
    run_v.text = "v1.8.0"
    run_v.font.name = FONT_MONO
    run_v.font.size = Pt(13)
    run_v.font.color.rgb = TEXT3


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    prs = new_prs()

    slide_01_cover(prs)
    slide_02_problem(prs)
    slide_03_solution(prs)
    slide_04_what_is_agent(prs)
    slide_05_features(prs)
    slide_06_how(prs)
    slide_07_collab(prs)
    slide_08_compat(prs)
    slide_09_status(prs)
    slide_10_why(prs)
    slide_11_close(prs)

    out = r"C:\claudedevmanager\cdm\docs\AgentHub_Presentacion_v1.8.0.pptx"
    prs.save(out)
    print(f"Guardado: {out}")

if __name__ == "__main__":
    main()
