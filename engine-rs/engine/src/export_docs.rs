//! Advanced exports of a meeting's notes: Markdown, DOCX and PDF.
//!
//! Our own code, no dependencies: the note (already through `notes::normalize_note_doc`) becomes a
//! small block model ([`Block`]), and each format is a renderer of that model.
//!
//! * Markdown: GitHub-flavoured, with a table for the actions and the transcript in a block.
//! * DOCX: hand-written OOXML in a stored (uncompressed) zip, headings, lists and tables from
//!   Word's built-in styles, so Word, Pages, LibreOffice and Google Docs open it.
//! * PDF: PDF 1.4, A4, the standard Helvetica fonts (WinAnsi). **Limit:** a character outside
//!   Windows-1252 (CJK, Arabic, Cyrillic, emoji, ...) prints as `?` in the PDF; DOCX and Markdown
//!   keep every character.

use serde_json::Value;

use crate::notes::{py_str, py_truthy};

/// A note's printable parts, in order.
#[derive(Debug, Clone, PartialEq)]
pub enum Block {
    Title(String),
    /// A grey line under the title (id, date, people).
    Meta(String),
    Heading(String),
    Para(String),
    /// `Some(done)` draws a checkbox.
    Bullet(String, Option<bool>),
    /// First row is the header.
    Table(Vec<Vec<String>>),
    /// A transcript line: timestamp, speaker, text, translation.
    Line(String, String, String, String),
    Footer(String),
}

fn text(value: Option<&Value>) -> String {
    value.map(py_str).unwrap_or_default()
}

fn present(value: Option<&Value>) -> Option<String> {
    value
        .filter(|v| py_truthy(v))
        .map(py_str)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn clock(secs: f64) -> String {
    let total = secs.max(0.0) as u64;
    if total >= 3600 {
        format!("{}:{:02}:{:02}", total / 3600, total / 60 % 60, total % 60)
    } else {
        format!("{:02}:{:02}", total / 60, total % 60)
    }
}

/// The note as blocks: title, who and when, summary, decisions, actions, the rest of the
/// register, the transcript.
pub fn blocks(note: &Value) -> Vec<Block> {
    let mut out = Vec::new();
    let title = present(note.get("title")).unwrap_or_else(|| "Meeting notes".to_string());
    out.push(Block::Title(title));
    let mut meta = Vec::new();
    for key in ["id", "date"] {
        if let Some(v) = present(note.get(key)) {
            meta.push(v);
        }
    }
    meta.push(
        if note.get("status").and_then(Value::as_str) == Some("issued") {
            "Issued".into()
        } else {
            "Draft".into()
        },
    );
    let m = note.get("meeting");
    if let Some(chair) = m.and_then(|m| present(m.get("chair"))) {
        meta.push(format!("Chair: {chair}"));
    }
    if let Some(Value::Array(a)) = m.and_then(|m| m.get("attendees")) {
        let names: Vec<String> = a
            .iter()
            .map(|x| py_str(x).trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if !names.is_empty() {
            meta.push(format!("Attendees: {}", names.join(", ")));
        }
    }
    if let Some(d) = m.and_then(|m| m.get("durationSec")).and_then(Value::as_f64) {
        meta.push(format!("Duration: {}", clock(d)));
    }
    out.push(Block::Meta(meta.join(" · ")));

    out.push(Block::Heading("Summary".into()));
    out.push(Block::Para(
        present(note.get("summary")).unwrap_or_else(|| "No summary yet.".into()),
    ));

    if let Some(Value::Array(decisions)) = note.get("decisions") {
        let rows: Vec<String> = decisions
            .iter()
            .map(|d| py_str(d).trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if !rows.is_empty() {
            out.push(Block::Heading("Decisions".into()));
            out.extend(rows.into_iter().map(|d| Block::Bullet(d, None)));
        }
    }
    if let Some(Value::Array(actions)) = note.get("actions") {
        if !actions.is_empty() {
            out.push(Block::Heading("Action items".into()));
            let mut rows = vec![vec![
                "Action".to_string(),
                "Owner".into(),
                "Due".into(),
                "Status".into(),
            ]];
            for a in actions {
                rows.push(vec![
                    text(a.get("text")),
                    present(a.get("owner")).unwrap_or_default(),
                    present(a.get("due")).unwrap_or_default(),
                    if a.get("status").and_then(Value::as_str) == Some("closed") {
                        "Done".into()
                    } else {
                        "Open".into()
                    },
                ]);
            }
            out.push(Block::Table(rows));
        }
    }
    // The register's questions, risks, metrics and notes (its decisions and actions are above).
    if let Some(Value::Array(items)) = note.get("items") {
        for (kind, label) in [
            ("question", "Open questions"),
            ("risk", "Risks"),
            ("metric", "Metrics"),
            ("info", "Information"),
        ] {
            let mine: Vec<&Value> = items
                .iter()
                .filter(|i| i.get("type").and_then(Value::as_str) == Some(kind))
                .collect();
            if mine.is_empty() {
                continue;
            }
            out.push(Block::Heading(label.into()));
            for i in mine {
                let mut line = text(i.get("text"));
                let mut tail = Vec::new();
                if let Some(r) = present(i.get("ref")) {
                    line = format!("{r} {line}");
                }
                if let Some(o) = present(i.get("owner")) {
                    tail.push(o);
                }
                if let Some(d) = present(i.get("due")) {
                    tail.push(format!("due {d}"));
                }
                if let Some(p) = present(i.get("priority")) {
                    tail.push(format!("{p} priority"));
                }
                if !tail.is_empty() {
                    line = format!("{line} ({})", tail.join(", "));
                }
                out.push(Block::Bullet(line, None));
            }
        }
    }
    if let Some(Value::Array(lines)) = note.get("transcript") {
        if !lines.is_empty() {
            out.push(Block::Heading("Transcript".into()));
            for l in lines {
                let t0 = l.get("t0").and_then(Value::as_f64).unwrap_or(0.0);
                out.push(Block::Line(
                    clock(t0),
                    present(l.get("speaker")).unwrap_or_default(),
                    text(l.get("source")),
                    present(l.get("translation")).unwrap_or_default(),
                ));
            }
        }
    }
    out.push(Block::Footer(
        "Drafted on-device. Nothing left this machine.".into(),
    ));
    out
}

// ------------------------------------------------------------------ Markdown

fn md_cell(s: &str) -> String {
    s.replace('|', "\\|").replace('\n', " ")
}

pub fn markdown(note: &Value) -> String {
    let mut out = String::new();
    for b in blocks(note) {
        match b {
            Block::Title(t) => out.push_str(&format!("# {t}\n\n")),
            Block::Meta(m) => out.push_str(&format!("_{m}_\n\n")),
            Block::Heading(h) => out.push_str(&format!("\n## {h}\n\n")),
            Block::Para(p) => out.push_str(&format!("{p}\n")),
            Block::Bullet(t, None) => out.push_str(&format!("- {t}\n")),
            Block::Bullet(t, Some(done)) => {
                out.push_str(&format!("- [{}] {t}\n", if done { "x" } else { " " }))
            }
            Block::Table(rows) => {
                out.push_str(&format!(
                    "| {} |\n",
                    rows[0]
                        .iter()
                        .map(|c| md_cell(c))
                        .collect::<Vec<_>>()
                        .join(" | ")
                ));
                out.push_str(&format!("|{}|\n", vec![" --- "; rows[0].len()].join("|")));
                for r in &rows[1..] {
                    out.push_str(&format!(
                        "| {} |\n",
                        r.iter().map(|c| md_cell(c)).collect::<Vec<_>>().join(" | ")
                    ));
                }
            }
            Block::Line(t, who, src, tr) => {
                let who = if who.is_empty() {
                    String::new()
                } else {
                    format!("**{who}:** ")
                };
                out.push_str(&format!("- `{t}` {who}{src}\n"));
                if !tr.is_empty() {
                    out.push_str(&format!("  - _{tr}_\n"));
                }
            }
            Block::Footer(f) => out.push_str(&format!("\n---\n_{f}_\n")),
        }
    }
    out
}

// ---------------------------------------------------------------------- DOCX

fn xml(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            // XML 1.0 forbids most control characters.
            c if (c as u32) < 0x20 && c != '\n' && c != '\t' => {}
            c => o.push(c),
        }
    }
    o
}

fn run(s: &str, props: &str) -> String {
    let mut o = String::new();
    for (i, part) in s.split('\n').enumerate() {
        if i > 0 {
            o.push_str("<w:r><w:br/></w:r>");
        }
        o.push_str(&format!(
            "<w:r>{props}<w:t xml:space=\"preserve\">{}</w:t></w:r>",
            xml(part)
        ));
    }
    o
}

fn para(style: &str, runs: &str) -> String {
    let st = if style.is_empty() {
        String::new()
    } else {
        format!("<w:pPr><w:pStyle w:val=\"{style}\"/></w:pPr>")
    };
    format!("<w:p>{st}{runs}</w:p>")
}

fn docx_body(blocks: &[Block]) -> String {
    let mut b = String::new();
    for block in blocks {
        match block {
            Block::Title(t) => b.push_str(&para("Title", &run(t, ""))),
            Block::Meta(m) => b.push_str(&para("Subtitle", &run(m, ""))),
            Block::Heading(h) => b.push_str(&para("Heading1", &run(h, ""))),
            Block::Para(p) => b.push_str(&para("", &run(p, ""))),
            Block::Bullet(t, done) => {
                let mark = match done {
                    Some(true) => "\u{2611} ",
                    Some(false) => "\u{2610} ",
                    None => "",
                };
                b.push_str(&para("ListBullet", &run(&format!("{mark}{t}"), "")));
            }
            Block::Table(rows) => {
                b.push_str("<w:tbl><w:tblPr><w:tblStyle w:val=\"TableGrid\"/><w:tblW w:w=\"5000\" w:type=\"pct\"/></w:tblPr>");
                let cols = rows[0].len();
                b.push_str("<w:tblGrid>");
                for _ in 0..cols {
                    b.push_str(&format!("<w:gridCol w:w=\"{}\"/>", 9000 / cols));
                }
                b.push_str("</w:tblGrid>");
                for (ri, r) in rows.iter().enumerate() {
                    b.push_str("<w:tr>");
                    if ri == 0 {
                        // Row 0 repeats on every page and is shaded.
                        b.push_str("<w:trPr><w:tblHeader/></w:trPr>");
                    }
                    for c in r {
                        let shade = if ri == 0 {
                            "<w:tcPr><w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"E8EAF2\"/></w:tcPr>"
                        } else {
                            ""
                        };
                        let props = if ri == 0 { "<w:rPr><w:b/></w:rPr>" } else { "" };
                        b.push_str(&format!("<w:tc>{shade}{}</w:tc>", para("", &run(c, props))));
                    }
                    b.push_str("</w:tr>");
                }
                b.push_str("</w:tbl>");
                b.push_str(&para("", ""));
            }
            Block::Line(t, who, src, tr) => {
                let mut runs = run(
                    &format!("[{t}] "),
                    "<w:rPr><w:color w:val=\"6B7294\"/></w:rPr>",
                );
                if !who.is_empty() {
                    runs.push_str(&run(&format!("{who}: "), "<w:rPr><w:b/></w:rPr>"));
                }
                runs.push_str(&run(src, ""));
                if !tr.is_empty() {
                    runs.push_str(&run(
                        &format!("\n{tr}"),
                        "<w:rPr><w:i/><w:color w:val=\"6B7294\"/></w:rPr>",
                    ));
                }
                b.push_str(&para("", &runs));
            }
            Block::Footer(f) => b.push_str(&para(
                "",
                &run(
                    f,
                    "<w:rPr><w:i/><w:color w:val=\"6B7294\"/><w:sz w:val=\"18\"/></w:rPr>",
                ),
            )),
        }
    }
    b
}

const STYLES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:color w:val="212C5F"/><w:sz w:val="44"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:color w:val="6B7294"/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="212C5F"/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:after="60"/></w:pPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="B8BDD4"/><w:left w:val="single" w:sz="4" w:space="0" w:color="B8BDD4"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="B8BDD4"/><w:right w:val="single" w:sz="4" w:space="0" w:color="B8BDD4"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="B8BDD4"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="B8BDD4"/></w:tblBorders></w:tblPr></w:style>
</w:styles>"#;

const NUMBERING: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#8226;"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="540" w:hanging="270"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>"#;

const CONTENT_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>"#;

const ROOT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>"#;

const DOC_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>"#;

pub fn docx(note: &Value) -> Vec<u8> {
    let bl = blocks(note);
    let title = bl
        .iter()
        .find_map(|b| {
            if let Block::Title(t) = b {
                Some(t.clone())
            } else {
                None
            }
        })
        .unwrap_or_default();
    let document = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>{}<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1134\" w:right=\"1134\" w:bottom=\"1134\" w:left=\"1134\" w:header=\"567\" w:footer=\"567\" w:gutter=\"0\"/></w:sectPr></w:body></w:document>",
        docx_body(&bl)
    );
    let core = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"><dc:title>{}</dc:title><dc:creator>yravgSubMeetly</dc:creator></cp:coreProperties>",
        xml(&title)
    );
    zip_stored(&[
        ("[Content_Types].xml", CONTENT_TYPES.as_bytes()),
        ("_rels/.rels", ROOT_RELS.as_bytes()),
        ("word/document.xml", document.as_bytes()),
        ("word/_rels/document.xml.rels", DOC_RELS.as_bytes()),
        ("word/styles.xml", STYLES.as_bytes()),
        ("word/numbering.xml", NUMBERING.as_bytes()),
        ("docProps/core.xml", core.as_bytes()),
    ])
}

fn crc32(data: &[u8]) -> u32 {
    static TABLE: std::sync::OnceLock<[u32; 256]> = std::sync::OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let mut t = [0u32; 256];
        for (i, slot) in t.iter_mut().enumerate() {
            let mut c = i as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 {
                    0xEDB8_8320 ^ (c >> 1)
                } else {
                    c >> 1
                };
            }
            *slot = c;
        }
        t
    });
    let mut c = 0xFFFF_FFFFu32;
    for &b in data {
        c = table[((c ^ b as u32) & 0xFF) as usize] ^ (c >> 8);
    }
    !c
}

/// A zip of stored (uncompressed) entries: valid for every reader, and these files are small.
pub fn zip_stored(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut central = Vec::new();
    for (name, data) in files {
        let offset = out.len() as u32;
        let crc = crc32(data);
        let n = name.as_bytes();
        // Local file header; flag 0x0800 = names are UTF-8; time 00:00, date 2026-01-01.
        out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        out.extend_from_slice(&[20, 0, 0x00, 0x08, 0, 0, 0, 0, 0x21, 0x5A]);
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&(n.len() as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(n);
        out.extend_from_slice(data);
        central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        central.extend_from_slice(&[20, 0, 20, 0, 0x00, 0x08, 0, 0, 0, 0, 0x21, 0x5A]);
        central.extend_from_slice(&crc.to_le_bytes());
        central.extend_from_slice(&(data.len() as u32).to_le_bytes());
        central.extend_from_slice(&(data.len() as u32).to_le_bytes());
        central.extend_from_slice(&(n.len() as u16).to_le_bytes());
        central.extend_from_slice(&[0; 12]);
        central.extend_from_slice(&offset.to_le_bytes());
        central.extend_from_slice(n);
    }
    let start = out.len() as u32;
    out.extend_from_slice(&central);
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&[0, 0, 0, 0]);
    out.extend_from_slice(&(files.len() as u16).to_le_bytes());
    out.extend_from_slice(&(files.len() as u16).to_le_bytes());
    out.extend_from_slice(&(central.len() as u32).to_le_bytes());
    out.extend_from_slice(&start.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out
}

// ----------------------------------------------------------------------- PDF

const PAGE_W: f32 = 595.0;
const PAGE_H: f32 = 842.0;
const MARGIN: f32 = 56.0;

/// Helvetica / Helvetica-Bold widths (1/1000 em) for WinAnsi 32..=126; other characters use 556.
const HELV: [u16; 95] = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
    556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
    611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
    667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
    222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/// One character as a Windows-1252 byte; anything else is `?`.
fn winansi(c: char) -> u8 {
    match c {
        ' '..='~' => c as u8,
        '\u{A0}'..='\u{FF}' => c as u8,
        '\u{2022}' => 0x95,
        '\u{2013}' => 0x96,
        '\u{2014}' => 0x97,
        '\u{2018}' => 0x91,
        '\u{2019}' => 0x92,
        '\u{201C}' => 0x93,
        '\u{201D}' => 0x94,
        '\u{2026}' => 0x85,
        '\u{20AC}' => 0x80,
        '\u{2122}' => 0x99,
        '\u{2610}' | '\u{2611}' => b'#',
        '\t' => b' ',
        _ => b'?',
    }
}

fn width(b: u8, bold: bool, size: f32) -> f32 {
    let w = if (32..=126).contains(&b) {
        HELV[(b - 32) as usize]
    } else {
        556
    };
    let w = if bold && w < 600 { w + 30 } else { w };
    w as f32 * size / 1000.0
}

/// Wrap `s` into lines at most `max` points wide (long words are broken).
fn wrap(s: &str, bold: bool, size: f32, max: f32) -> Vec<Vec<u8>> {
    let mut lines = Vec::new();
    for paragraph in s.split('\n') {
        let mut line: Vec<u8> = Vec::new();
        let mut lw = 0.0f32;
        for word in paragraph.split(' ') {
            let bytes: Vec<u8> = word.chars().map(winansi).collect();
            let ww: f32 = bytes.iter().map(|&b| width(b, bold, size)).sum();
            let sp = width(b' ', bold, size);
            if !line.is_empty() && lw + sp + ww > max {
                lines.push(std::mem::take(&mut line));
                lw = 0.0;
            }
            if ww > max {
                for b in bytes {
                    let w = width(b, bold, size);
                    if lw + w > max {
                        lines.push(std::mem::take(&mut line));
                        lw = 0.0;
                    }
                    line.push(b);
                    lw += w;
                }
                continue;
            }
            if !line.is_empty() {
                line.push(b' ');
                lw += sp;
            }
            line.extend_from_slice(&bytes);
            lw += ww;
        }
        lines.push(line);
    }
    lines
}

fn pdf_str(bytes: &[u8]) -> Vec<u8> {
    let mut o = vec![b'('];
    for &b in bytes {
        if matches!(b, b'(' | b')' | b'\\') {
            o.push(b'\\');
        }
        o.push(b);
    }
    o.push(b')');
    o
}

struct Pages {
    done: Vec<Vec<u8>>,
    cur: Vec<u8>,
    y: f32,
}

impl Pages {
    fn new() -> Self {
        Pages {
            done: Vec::new(),
            cur: Vec::new(),
            y: PAGE_H - MARGIN,
        }
    }
    fn need(&mut self, h: f32) {
        if self.y - h < MARGIN {
            self.done.push(std::mem::take(&mut self.cur));
            self.y = PAGE_H - MARGIN;
        }
    }
    /// Draw wrapped text at x; font F1 regular / F2 bold.
    #[allow(clippy::too_many_arguments)]
    fn text(
        &mut self,
        s: &str,
        x: f32,
        size: f32,
        bold: bool,
        rgb: (f32, f32, f32),
        max: f32,
        gap: f32,
    ) {
        let lead = size * 1.35;
        for l in wrap(s, bold, size, max) {
            self.need(lead);
            self.y -= lead;
            self.cur.extend_from_slice(
                format!(
                    "BT /{} {size} Tf {} {} {} rg {x} {} Td ",
                    if bold { "F2" } else { "F1" },
                    rgb.0,
                    rgb.1,
                    rgb.2,
                    self.y
                )
                .as_bytes(),
            );
            self.cur.extend(pdf_str(&l));
            self.cur.extend_from_slice(b" Tj ET\n");
        }
        self.y -= gap;
    }
    fn rect(&mut self, x: f32, y: f32, w: f32, h: f32, rgb: (f32, f32, f32)) {
        self.cur.extend_from_slice(
            format!("{} {} {} rg {x} {y} {w} {h} re f\n", rgb.0, rgb.1, rgb.2).as_bytes(),
        );
    }
    fn line(&mut self, x1: f32, x2: f32, y: f32) {
        self.cur.extend_from_slice(
            format!("0.72 0.74 0.83 RG 0.5 w {x1} {y} m {x2} {y} l S\n").as_bytes(),
        );
    }
}

const NAVY: (f32, f32, f32) = (0.13, 0.17, 0.37);
const INK: (f32, f32, f32) = (0.07, 0.1, 0.27);
const MUTED: (f32, f32, f32) = (0.42, 0.45, 0.58);

pub fn pdf(note: &Value) -> Vec<u8> {
    let bl = blocks(note);
    let inner = PAGE_W - 2.0 * MARGIN;
    let mut p = Pages::new();
    for b in &bl {
        match b {
            Block::Title(t) => p.text(t, MARGIN, 22.0, true, NAVY, inner, 4.0),
            Block::Meta(m) => p.text(m, MARGIN, 9.5, false, MUTED, inner, 14.0),
            Block::Heading(h) => {
                p.need(40.0);
                p.y -= 10.0;
                p.text(h, MARGIN, 14.0, true, NAVY, inner, 4.0)
            }
            Block::Para(t) => p.text(t, MARGIN, 10.5, false, INK, inner, 6.0),
            Block::Bullet(t, done) => {
                let mark = match done {
                    Some(true) => "[x] ",
                    Some(false) => "[ ] ",
                    None => "",
                };
                p.need(14.0);
                let y = p.y;
                if done.is_none() {
                    p.rect(MARGIN + 3.0, y - 9.5, 3.0, 3.0, NAVY);
                }
                p.text(
                    &format!("{mark}{t}"),
                    MARGIN + 16.0,
                    10.5,
                    false,
                    INK,
                    inner - 16.0,
                    3.0,
                )
            }
            Block::Table(rows) => {
                let cols = rows[0].len();
                // Action | Owner | Due | Status widths.
                let ws: Vec<f32> = if cols == 4 {
                    vec![inner * 0.52, inner * 0.20, inner * 0.14, inner * 0.14]
                } else {
                    vec![inner / cols as f32; cols]
                };
                for (ri, r) in rows.iter().enumerate() {
                    let header = ri == 0;
                    let size = 9.5;
                    let cells: Vec<Vec<Vec<u8>>> = r
                        .iter()
                        .zip(&ws)
                        .map(|(c, w)| wrap(c, header, size, w - 10.0))
                        .collect();
                    let nlines = cells.iter().map(|c| c.len()).max().unwrap_or(1);
                    let h = nlines as f32 * size * 1.35 + 8.0;
                    p.need(h);
                    let top = p.y;
                    if header {
                        p.rect(MARGIN, top - h, inner, h, (0.91, 0.92, 0.95));
                    }
                    let mut x = MARGIN;
                    for (ci, lines) in cells.iter().enumerate() {
                        let mut y = top - 4.0;
                        for l in lines {
                            y -= size * 1.35;
                            p.cur.extend_from_slice(
                                format!(
                                    "BT /{} {size} Tf {} {} {} rg {} {} Td ",
                                    if header { "F2" } else { "F1" },
                                    INK.0,
                                    INK.1,
                                    INK.2,
                                    x + 5.0,
                                    y + 3.0
                                )
                                .as_bytes(),
                            );
                            p.cur.extend(pdf_str(l));
                            p.cur.extend_from_slice(b" Tj ET\n");
                        }
                        x += ws[ci];
                    }
                    p.line(MARGIN, MARGIN + inner, top - h);
                    p.y = top - h;
                }
                p.y -= 8.0;
            }
            Block::Line(t, who, src, tr) => {
                let who = if who.is_empty() {
                    String::new()
                } else {
                    format!("{who}: ")
                };
                p.need(14.0);
                let y = p.y - 10.5 * 1.35;
                p.cur.extend_from_slice(
                    format!(
                        "BT /F1 8.5 Tf {} {} {} rg {MARGIN} {y} Td ",
                        MUTED.0, MUTED.1, MUTED.2
                    )
                    .as_bytes(),
                );
                p.cur
                    .extend(pdf_str(&t.chars().map(winansi).collect::<Vec<u8>>()));
                p.cur.extend_from_slice(b" Tj ET\n");
                p.text(
                    &format!("{who}{src}"),
                    MARGIN + 46.0,
                    10.0,
                    false,
                    INK,
                    inner - 46.0,
                    if tr.is_empty() { 3.0 } else { 0.0 },
                );
                if !tr.is_empty() {
                    p.text(tr, MARGIN + 46.0, 9.5, false, MUTED, inner - 46.0, 3.0);
                }
            }
            Block::Footer(f) => {
                p.y -= 12.0;
                p.need(24.0);
                let y = p.y;
                p.line(MARGIN, MARGIN + inner, y);
                p.y -= 6.0;
                p.text(f, MARGIN, 8.5, false, MUTED, inner, 0.0)
            }
        }
    }
    p.done.push(std::mem::take(&mut p.cur));
    let total = p.done.len();

    // Objects: 1 catalog, 2 pages, 3 F1, 4 F2, then per page: content, page.
    let mut objs: Vec<Vec<u8>> = Vec::new();
    objs.push(b"<< /Type /Catalog /Pages 2 0 R >>".to_vec());
    let kids: Vec<String> = (0..total).map(|i| format!("{} 0 R", 6 + i * 2)).collect();
    objs.push(
        format!(
            "<< /Type /Pages /Kids [{}] /Count {total} >>",
            kids.join(" ")
        )
        .into_bytes(),
    );
    objs.push(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
            .to_vec(),
    );
    objs.push(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
            .to_vec(),
    );
    let title = bl
        .iter()
        .find_map(|b| {
            if let Block::Title(t) = b {
                Some(t.clone())
            } else {
                None
            }
        })
        .unwrap_or_default();
    let info: Vec<u8> = [
        b"<< /Title ".to_vec(),
        pdf_str(&title.chars().map(winansi).collect::<Vec<u8>>()),
        b" /Producer (yravgSubMeetly) >>".to_vec(),
    ]
    .concat();
    objs.push(info);
    for (i, content) in p.done.iter().enumerate() {
        let mut c = format!("<< /Length {} >>\nstream\n", content.len()).into_bytes();
        c.extend_from_slice(content);
        c.extend_from_slice(b"\nendstream");
        objs.push(c);
        objs.push(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {} 0 R >>", 5 + i * 2 + 1).into_bytes());
    }
    // Object numbers: 1..=5 fixed (5 = info), content = 6 + 2i, page = 7 + 2i. Fix the Kids above.
    let kids: Vec<String> = (0..total).map(|i| format!("{} 0 R", 7 + i * 2)).collect();
    objs[1] = format!(
        "<< /Type /Pages /Kids [{}] /Count {total} >>",
        kids.join(" ")
    )
    .into_bytes();
    for i in 0..total {
        objs[5 + i * 2 + 1] = format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {} 0 R >>", 6 + i * 2).into_bytes();
    }

    let mut out = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets = Vec::new();
    for (i, o) in objs.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
        out.extend_from_slice(o);
        out.extend_from_slice(b"\nendobj\n");
    }
    let xref = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).as_bytes());
    for off in offsets {
        out.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R /Info 5 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objs.len() + 1
        )
        .as_bytes(),
    );
    out
}

// -------------------------------------------------------------------- base64

pub fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut o = String::with_capacity(data.len() * 4 / 3 + 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16
            | (*c.get(1).unwrap_or(&0) as u32) << 8
            | *c.get(2).unwrap_or(&0) as u32;
        o.push(T[(n >> 18) as usize & 63] as char);
        o.push(T[(n >> 12) as usize & 63] as char);
        o.push(if c.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        o.push(if c.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    o
}

/// (MIME type, bytes) for `docx` or `pdf`.
pub fn binary(format: &str, note: &Value) -> Option<(&'static str, Vec<u8>)> {
    match format {
        "docx" => Some((
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            docx(note),
        )),
        "pdf" => Some(("application/pdf", pdf(note))),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn note() -> Value {
        json!({
            "id": "MOM-1", "title": "Weekly sync: A & B <review>", "date": "2026-11-12", "status": "issued",
            "summary": "We agreed the plan.\nSecond line with “quotes”, an em—dash and 日本語.",
            "decisions": ["Ship v1.4", "Drop the old API (v0)"],
            "actions": [{"id": "a1", "text": "Write the release notes", "owner": "Alya", "due": "2026-11-20", "status": "open"},
                        {"id": "a2", "text": "Close the | pipe issue", "owner": null, "due": null, "status": "closed"}],
            "items": [{"type": "risk", "ref": "R-1", "text": "Signing key rotation", "owner": "Budi", "priority": "high"}],
            "meeting": {"chair": "Alya", "attendees": ["Alya", "Budi"], "durationSec": 3725},
            "transcript": (0..120).map(|i| json!({"t0": i as f64 * 7.0, "t1": i as f64 * 7.0 + 5.0, "source": format!("Line number {i} with enough words to wrap across the page width when long, repeated again and again to force wrapping."), "translation": if i % 3 == 0 { "Terjemahan baris" } else { "" }, "speaker": if i % 2 == 0 { "Alya" } else { "Budi" }})).collect::<Vec<_>>(),
        })
    }

    #[test]
    fn markdown_has_the_parts() {
        let md = markdown(&note());
        assert!(md.starts_with("# Weekly sync: A & B <review>\n"));
        assert!(md.contains("## Decisions\n\n- Ship v1.4"));
        assert!(md.contains("| Action | Owner | Due | Status |"));
        assert!(md.contains("Close the \\| pipe issue"));
        assert!(md.contains("- `00:07` **Budi:** Line number 1"));
        assert!(md.contains("## Risks"));
    }

    #[test]
    fn docx_is_a_valid_zip_with_wellformed_xml() {
        let z = docx(&note());
        assert_eq!(&z[..4], b"PK\x03\x04");
        // End of central directory: 7 entries.
        let eocd = z.len() - 22;
        assert_eq!(&z[eocd..eocd + 4], b"PK\x05\x06");
        assert_eq!(u16::from_le_bytes([z[eocd + 10], z[eocd + 11]]), 7);
        let s = String::from_utf8_lossy(&z);
        for name in [
            "[Content_Types].xml",
            "word/document.xml",
            "word/styles.xml",
            "word/numbering.xml",
        ] {
            assert!(s.contains(name), "{name}");
        }
        // The escaped title and the CJK survived; no raw `<review>`.
        assert!(s.contains("A &amp; B &lt;review&gt;"));
        assert!(s.contains("日本語"));
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    }

    #[test]
    fn pdf_is_structurally_valid_and_paginates() {
        let d = pdf(&note());
        assert!(d.starts_with(b"%PDF-1.4"));
        assert!(d.ends_with(b"%%EOF\n"));
        let s = String::from_utf8_lossy(&d).to_string();
        // startxref points at the xref table; every xref entry points at "<n> 0 obj".
        let sx: usize = s
            .rsplit("startxref\n")
            .next()
            .unwrap()
            .lines()
            .next()
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(&d[sx..sx + 4], b"xref");
        let table_owned = String::from_utf8_lossy(&d[sx..]).to_string();
        let table = table_owned.as_str();
        let count: usize = table
            .lines()
            .nth(1)
            .unwrap()
            .split(' ')
            .nth(1)
            .unwrap()
            .parse()
            .unwrap();
        for (i, line) in table.lines().skip(3).take(count - 1).enumerate() {
            let off: usize = line[..10].parse().unwrap();
            assert!(
                d[off..].starts_with(format!("{} 0 obj", i + 1).as_bytes()),
                "object {}",
                i + 1
            );
        }
        let pages = s.matches("/Type /Page ").count();
        assert!(pages >= 3, "{pages} pages");
        assert!(s.contains(&format!("/Count {pages}")));
        // Stream lengths are exact (checked on bytes: the content holds WinAnsi bytes).
        let mut at = 0;
        let mut streams = 0;
        while let Some(i) = find(&d[at..], b"/Length ") {
            let start = at + i + 8;
            let end = start + d[start..].iter().position(|&c| c == b' ').unwrap();
            let n: usize = std::str::from_utf8(&d[start..end])
                .unwrap()
                .parse()
                .unwrap();
            let body = start + find(&d[start..], b"stream\n").unwrap() + 7;
            assert!(
                d[body + n..].starts_with(b"\nendstream"),
                "stream at {body}"
            );
            streams += 1;
            at = body + n;
        }
        assert_eq!(streams, pages);
    }

    fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
        hay.windows(needle.len()).position(|w| w == needle)
    }

    #[test]
    fn pdf_replaces_what_winansi_cannot_draw() {
        assert_eq!(winansi('é'), 0xE9);
        assert_eq!(winansi('—'), 0x97);
        assert_eq!(winansi('日'), b'?');
    }

    #[test]
    fn base64_matches_the_rfc() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn an_empty_note_still_exports() {
        let n = json!({"title": "", "decisions": [], "actions": []});
        assert!(markdown(&n).contains("# Meeting notes"));
        assert!(docx(&n).len() > 500);
        assert!(pdf(&n).starts_with(b"%PDF"));
    }
}
