//! Summary templates: named sets of sections (heading + prompt + kind) that shape the notes
//! `/notes/generate` and `/notes/summarize` produce. Seven built-ins are read-only; the
//! person's own live in `note-templates.json` in the engine's state directory.
//!
//! Two paths render a template: the local heuristic (no model: keyword extraction per
//! section `kind`) and, when the AI connector is on, a prompt built from the sections.

use std::path::Path;

use anyhow::{bail, Result};
use serde_json::{json, Value};

const FILE: &str = "note-templates.json";
const KINDS: [&str; 7] = [
    "summary",
    "decisions",
    "actions",
    "questions",
    "risks",
    "topics",
    "notes",
];

#[derive(Clone, Debug, PartialEq)]
pub struct Section {
    pub heading: String,
    pub prompt: String,
    pub kind: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Template {
    pub id: String,
    pub name: String,
    pub description: String,
    /// "bullets" or "prose".
    pub style: String,
    pub sections: Vec<Section>,
    pub builtin: bool,
}

impl Template {
    pub fn to_json(&self) -> Value {
        json!({
            "id": self.id, "name": self.name, "description": self.description, "style": self.style, "builtin": self.builtin,
            "sections": self.sections.iter().map(|s| json!({ "heading": s.heading, "prompt": s.prompt, "kind": s.kind })).collect::<Vec<_>>(),
        })
    }
}

fn sec(heading: &str, prompt: &str, kind: &str) -> Section {
    Section {
        heading: heading.into(),
        prompt: prompt.into(),
        kind: kind.into(),
    }
}

fn built(id: &str, name: &str, description: &str, style: &str, sections: Vec<Section>) -> Template {
    Template {
        id: id.into(),
        name: name.into(),
        description: description.into(),
        style: style.into(),
        sections,
        builtin: true,
    }
}

pub fn builtins() -> Vec<Template> {
    vec![
        built(
            "general",
            "General",
            "Summary, decisions and action items.",
            "bullets",
            vec![
                sec(
                    "Summary",
                    "A short summary of what was discussed.",
                    "summary",
                ),
                sec("Decisions", "Decisions that were made.", "decisions"),
                sec(
                    "Action items",
                    "Tasks with an owner and a due date when said.",
                    "actions",
                ),
            ],
        ),
        built(
            "standup",
            "Standup",
            "What got done, what is next, what blocks.",
            "bullets",
            vec![
                sec(
                    "Done",
                    "What each person finished since last time.",
                    "topics",
                ),
                sec("Next", "What each person will do next.", "actions"),
                sec("Blockers", "Anything blocking progress.", "risks"),
            ],
        ),
        built(
            "one-on-one",
            "1:1",
            "Topics, feedback, follow-ups.",
            "bullets",
            vec![
                sec("Topics", "What was talked about.", "topics"),
                sec("Feedback", "Feedback given in either direction.", "notes"),
                sec("Follow-ups", "Commitments from both people.", "actions"),
            ],
        ),
        built(
            "sales-call",
            "Sales call",
            "Needs, objections, next steps.",
            "bullets",
            vec![
                sec(
                    "Summary",
                    "Who the prospect is and why they called.",
                    "summary",
                ),
                sec(
                    "Needs and pain points",
                    "What the customer needs.",
                    "topics",
                ),
                sec(
                    "Objections and risks",
                    "Doubts, competitors, blockers.",
                    "risks",
                ),
                sec("Next steps", "Agreed next steps and owners.", "actions"),
            ],
        ),
        built(
            "interview",
            "Interview",
            "Impressions, strengths, concerns, questions.",
            "bullets",
            vec![
                sec("Summary", "Candidate and role in two sentences.", "summary"),
                sec("Strengths", "What went well.", "topics"),
                sec("Concerns", "What worries the interviewers.", "risks"),
                sec("Open questions", "What is still unknown.", "questions"),
            ],
        ),
        built(
            "retro",
            "Retrospective",
            "What went well, what did not, what to change.",
            "bullets",
            vec![
                sec("What went well", "Positive points.", "topics"),
                sec(
                    "What did not go well",
                    "Problems and frustrations.",
                    "risks",
                ),
                sec("Changes to try", "Agreed experiments.", "actions"),
            ],
        ),
        built(
            "project-status",
            "Project status",
            "Progress, risks, decisions, next steps.",
            "prose",
            vec![
                sec("Progress", "Where the project stands.", "summary"),
                sec("Risks and issues", "What could derail the plan.", "risks"),
                sec("Decisions", "Decisions that were made.", "decisions"),
                sec("Next steps", "Who does what next.", "actions"),
                sec(
                    "Open questions",
                    "Questions that need an answer.",
                    "questions",
                ),
            ],
        ),
    ]
}

fn user_path(dir: &Path) -> std::path::PathBuf {
    dir.join(FILE)
}

fn parse_template(v: &Value, builtin: bool) -> Option<Template> {
    let s = |k: &str| {
        v.get(k)
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string()
    };
    let sections: Vec<Section> = v
        .get("sections")?
        .as_array()?
        .iter()
        .filter_map(|x| {
            let heading = x.get("heading").and_then(Value::as_str)?.trim().to_string();
            let kind = x
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or("notes")
                .trim()
                .to_string();
            (!heading.is_empty()).then(|| Section {
                heading,
                prompt: x
                    .get("prompt")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim()
                    .to_string(),
                kind: if KINDS.contains(&kind.as_str()) {
                    kind
                } else {
                    "notes".into()
                },
            })
        })
        .collect();
    let (id, name) = (s("id"), s("name"));
    if id.is_empty() || name.is_empty() || sections.is_empty() {
        return None;
    }
    Some(Template {
        id,
        name,
        description: s("description"),
        style: if s("style") == "prose" {
            "prose".into()
        } else {
            "bullets".into()
        },
        sections,
        builtin,
    })
}

fn read_file(dir: &Path) -> Value {
    std::fs::read_to_string(user_path(dir))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .unwrap_or_else(|| json!({}))
}

fn load_user(dir: &Path) -> Vec<Template> {
    read_file(dir)
        .get("templates")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|t| parse_template(t, false)).collect())
        .unwrap_or_default()
}

/// The template used when a request names none (`null` = the engine's plain notes, as before).
pub fn default_id(dir: &Path) -> Option<String> {
    let id = read_file(dir)
        .get("default")
        .and_then(Value::as_str)
        .map(str::to_string)?;
    find(dir, &id).map(|t| t.id)
}

pub fn set_default(dir: &Path, id: Option<&str>) -> Result<()> {
    if let Some(id) = id.filter(|i| !i.is_empty()) {
        if find(dir, id).is_none() {
            bail!("unknown template {id:?}");
        }
    }
    write_file(dir, &load_user(dir), id.filter(|i| !i.is_empty()))
}

fn write_file(dir: &Path, list: &[Template], default: Option<&str>) -> Result<()> {
    std::fs::create_dir_all(dir)?;
    let body = json!({ "templates": list.iter().map(Template::to_json).collect::<Vec<_>>(), "default": default });
    let tmp = user_path(dir).with_extension("json.tmp");
    std::fs::write(&tmp, body.to_string())?;
    std::fs::rename(&tmp, user_path(dir))?;
    Ok(())
}

fn save_user(dir: &Path, list: &[Template]) -> Result<()> {
    let default = read_file(dir)
        .get("default")
        .and_then(Value::as_str)
        .map(str::to_string);
    // A deleted template cannot stay the default.
    let default = default
        .filter(|d| builtins().iter().any(|b| &b.id == d) || list.iter().any(|t| &t.id == d));
    write_file(dir, list, default.as_deref())
}

/// Built-ins first, then the person's.
pub fn all(dir: &Path) -> Vec<Template> {
    let mut v = builtins();
    v.extend(load_user(dir));
    v
}

pub fn find(dir: &Path, id: &str) -> Option<Template> {
    all(dir).into_iter().find(|t| t.id == id)
}

fn slug(name: &str) -> String {
    let s: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    let s = s
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    s.chars().take(40).collect()
}

/// Create or replace one of the person's templates from a `POST /notes/templates` body.
pub fn upsert(dir: &Path, body: &Value) -> Result<Template> {
    let name = body
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if name.is_empty() || name.chars().count() > 60 {
        bail!("name is required (up to 60 characters)");
    }
    let raw = body
        .get("sections")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if raw.is_empty() || raw.len() > 12 {
        bail!("a template needs 1 to 12 sections");
    }
    for s in &raw {
        let h = s
            .get("heading")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if h.is_empty() || h.chars().count() > 60 {
            bail!("every section needs a heading (up to 60 characters)");
        }
        if s.get("prompt")
            .and_then(Value::as_str)
            .unwrap_or("")
            .chars()
            .count()
            > 500
        {
            bail!("a section prompt is limited to 500 characters");
        }
    }
    let mut user = load_user(dir);
    let wanted = body
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if builtins().iter().any(|b| b.id == wanted) {
        bail!("built-in templates are read-only; save a copy under a new name");
    }
    let id = if !wanted.is_empty() && user.iter().any(|t| t.id == wanted) {
        wanted
    } else {
        let base = format!("custom-{}", slug(&name));
        let mut id = base.clone();
        let mut n = 2;
        while user.iter().any(|t| t.id == id) || builtins().iter().any(|b| b.id == id) {
            id = format!("{base}-{n}");
            n += 1;
        }
        id
    };
    let mut candidate = body.clone();
    candidate["id"] = json!(id);
    let Some(t) = parse_template(&candidate, false) else {
        bail!("the template is not valid")
    };
    match user.iter().position(|u| u.id == t.id) {
        Some(i) => user[i] = t.clone(),
        None => user.push(t.clone()),
    }
    if user.len() > 50 {
        bail!("at most 50 custom templates");
    }
    save_user(dir, &user)?;
    Ok(t)
}

pub fn delete(dir: &Path, id: &str) -> Result<bool> {
    if builtins().iter().any(|b| b.id == id) {
        bail!("built-in templates cannot be deleted");
    }
    let mut user = load_user(dir);
    let before = user.len();
    user.retain(|t| t.id != id);
    if user.len() == before {
        return Ok(false);
    }
    save_user(dir, &user)?;
    Ok(true)
}

/// The `template` field of a generate/summarize body: an id, an inline template object, or nothing.
pub fn resolve(dir: &Path, field: Option<&Value>) -> Result<Option<Template>> {
    match field {
        // Nothing named: the person's default template, if they chose one. An empty string says "none".
        None | Some(Value::Null) => Ok(default_id(dir).and_then(|id| find(dir, &id))),
        Some(Value::String(id)) if id.trim().is_empty() => Ok(None),
        Some(Value::String(id)) => match find(dir, id.trim()) {
            Some(t) => Ok(Some(t)),
            None => bail!("unknown template {id:?}"),
        },
        Some(v @ Value::Object(_)) => {
            let mut v = v.clone();
            if v.get("id").is_none() {
                v["id"] = json!("inline");
            }
            parse_template(&v, false)
                .map(Some)
                .ok_or_else(|| anyhow::anyhow!("the inline template is not valid"))
        }
        Some(_) => bail!("template must be an id or an object"),
    }
}

/// `GET /notes/templates`.
pub fn list_json(dir: &Path) -> Value {
    json!({ "templates": all(dir).iter().map(Template::to_json).collect::<Vec<_>>(), "kinds": KINDS, "default": default_id(dir) })
}

// ---------------------------------------------------------------------------------------
// Rendering

const RISK_WORDS: [&str; 10] = [
    "risk", "risiko", "blocker", "blocked", "kendala", "masalah", "issue", "concern", "worry",
    "khawatir",
];

/// Sentences of the transcript (split on . ! ? and line ends), trimmed.
fn sentences(texts: &[String]) -> Vec<String> {
    texts
        .iter()
        .flat_map(|t| {
            t.split_inclusive(['.', '!', '?', '\n'])
                .map(|s| s.trim().to_string())
                .collect::<Vec<_>>()
        })
        .filter(|s| s.chars().count() >= 8)
        .collect()
}

fn clip(s: &str, n: usize) -> String {
    let t: String = s.chars().take(n).collect();
    if s.chars().count() > n {
        format!("{}…", t.trim_end())
    } else {
        t
    }
}

/// One section's items, locally, from the heuristic note (`summary`, `decisions`, `actions`) and the lines.
fn local_items(kind: &str, note: &Value, texts: &[String]) -> Vec<String> {
    let strings = |k: &str| {
        note[k]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    };
    match kind {
        "summary" => note["summary"]
            .as_str()
            .map(|s| vec![s.to_string()])
            .unwrap_or_default(),
        "decisions" => strings("decisions"),
        "actions" => note["actions"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|v| v["text"].as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
        "questions" => sentences(texts)
            .into_iter()
            .filter(|s| s.ends_with('?'))
            .take(8)
            .collect(),
        "risks" => sentences(texts)
            .into_iter()
            .filter(|s| {
                let l = s.to_lowercase();
                RISK_WORDS.iter().any(|w| l.contains(w))
            })
            .take(8)
            .map(|s| clip(&s, 160))
            .collect(),
        // topics / notes: the first distinct segments, a few.
        _ => {
            let mut seen = Vec::new();
            for t in texts {
                let c = clip(t, 140);
                if !seen.contains(&c) {
                    seen.push(c);
                }
                if seen.len() >= 6 {
                    break;
                }
            }
            seen
        }
    }
}

/// Render the template over the heuristic note; the result is `sections` plus a Markdown body.
pub fn render_local(t: &Template, note: &Value, texts: &[String]) -> Value {
    let sections: Vec<Value> = t.sections.iter().map(|s| json!({ "heading": s.heading, "kind": s.kind, "items": local_items(&s.kind, note, texts) })).collect();
    json!({ "template": t.id, "sections": sections, "markdown": markdown(&t.style, &sections) })
}

pub fn markdown(style: &str, sections: &[Value]) -> String {
    let mut out = String::new();
    for s in sections {
        out.push_str(&format!("## {}\n\n", s["heading"].as_str().unwrap_or("")));
        let items: Vec<&str> = s["items"]
            .as_array()
            .map(|a| a.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        if items.is_empty() {
            out.push_str("_Nothing noted._\n\n");
        } else if style == "prose" {
            out.push_str(&items.join(" "));
            out.push_str("\n\n");
        } else {
            for i in items {
                out.push_str(&format!("- {i}\n"));
            }
            out.push('\n');
        }
    }
    out.trim_end().to_string() + "\n"
}

/// The system prompt for the connector: the sections, as `## Heading` blocks the answer must follow.
pub fn system_prompt(t: &Template) -> String {
    let mut p = String::from("You write meeting notes from a transcript. Write in the language of the transcript. Be faithful: never invent facts, names or dates. Answer in Markdown with exactly these sections, in this order, each starting with a line `## <heading>`:\n");
    for s in &t.sections {
        p.push_str(&format!(
            "\n## {}\n({})\n",
            s.heading,
            if s.prompt.is_empty() {
                "the relevant points"
            } else {
                &s.prompt
            }
        ));
    }
    p.push_str(if t.style == "prose" {
        "\nUse short paragraphs under each heading."
    } else {
        "\nUse short bullet points (`- `) under each heading."
    });
    p.push_str("\nIf a section has nothing in the transcript, write `_Nothing noted._` under it.");
    p
}

/// Split a Markdown answer into `{heading, items}` by `## ` lines; bullets become items, prose one item per paragraph.
pub fn parse_markdown(t: &Template, text: &str) -> Vec<Value> {
    let mut out: Vec<(String, Vec<String>)> = Vec::new();
    for line in text.lines() {
        let l = line.trim();
        if let Some(h) = l.strip_prefix("## ") {
            out.push((h.trim().to_string(), Vec::new()));
        } else if let Some((_, items)) = out.last_mut() {
            if l.is_empty() || l == "_Nothing noted._" {
                continue;
            }
            let item = l.trim_start_matches(['-', '*', '•']).trim();
            if (l.starts_with('-') || l.starts_with('*') || l.starts_with('•')) || items.is_empty()
            {
                items.push(item.to_string());
            } else if let Some(last) = items.last_mut() {
                last.push(' ');
                last.push_str(item);
            }
        }
    }
    t.sections
        .iter()
        .map(|s| {
            let found = out.iter().find(|(h, _)| h.eq_ignore_ascii_case(&s.heading));
            json!({ "heading": s.heading, "kind": s.kind, "items": found.map(|(_, i)| i.clone()).unwrap_or_default() })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("ysm-tpl-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn seven_builtins_are_listed_and_read_only() {
        let d = dir("b");
        let ids: Vec<String> = all(&d).into_iter().map(|t| t.id).collect();
        assert_eq!(
            ids,
            [
                "general",
                "standup",
                "one-on-one",
                "sales-call",
                "interview",
                "retro",
                "project-status"
            ]
        );
        assert!(upsert(
            &d,
            &json!({ "id": "general", "name": "x", "sections": [{ "heading": "h" }] })
        )
        .is_err());
        assert!(delete(&d, "general").is_err());
    }

    #[test]
    fn user_templates_round_trip_and_get_unique_ids() {
        let d = dir("u");
        let body = json!({ "name": "Weekly sync", "style": "prose", "sections": [{ "heading": "Wins", "kind": "topics", "prompt": "good news" }, { "heading": "Asks" }] });
        let a = upsert(&d, &body).unwrap();
        let b = upsert(&d, &body).unwrap();
        assert_eq!(a.id, "custom-weekly-sync");
        assert_eq!(b.id, "custom-weekly-sync-2");
        assert_eq!(find(&d, &a.id).unwrap().sections[1].kind, "notes");
        assert_eq!(find(&d, &a.id).unwrap().style, "prose");
        // Editing keeps the id.
        let edited = upsert(
            &d,
            &json!({ "id": a.id, "name": "Weekly sync v2", "sections": [{ "heading": "Only" }] }),
        )
        .unwrap();
        assert_eq!(edited.id, a.id);
        assert_eq!(all(&d).len(), 7 + 2);
        assert!(delete(&d, &a.id).unwrap());
        assert!(!delete(&d, &a.id).unwrap());
        assert!(upsert(&d, &json!({ "name": "", "sections": [{ "heading": "h" }] })).is_err());
        assert!(upsert(&d, &json!({ "name": "n", "sections": [] })).is_err());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_default_template_is_chosen_kept_and_dropped_with_its_template() {
        let d = dir("d");
        assert_eq!(default_id(&d), None);
        assert!(set_default(&d, Some("nope")).is_err());
        set_default(&d, Some("standup")).unwrap();
        assert_eq!(default_id(&d).as_deref(), Some("standup"));
        assert_eq!(resolve(&d, None).unwrap().unwrap().id, "standup");
        assert!(resolve(&d, Some(&json!(""))).unwrap().is_none());
        let mine = upsert(
            &d,
            &json!({ "name": "Mine", "sections": [{ "heading": "h" }] }),
        )
        .unwrap();
        // Saving another template keeps the default; deleting the default's template clears it.
        assert_eq!(default_id(&d).as_deref(), Some("standup"));
        set_default(&d, Some(&mine.id)).unwrap();
        delete(&d, &mine.id).unwrap();
        assert_eq!(default_id(&d), None);
        set_default(&d, None).unwrap();
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_local_renderer_fills_each_kind() {
        let texts: Vec<String> = vec![
            "Keputusan: kita rilis hari Jumat.".into(),
            "Ada risiko vendor terlambat mengirim server.".into(),
            "Siapa yang menyiapkan demo nanti?".into(),
            "Todo: kirim laporan mingguan ke tim.".into(),
        ];
        let note = crate::heuristic::heuristic_notes(
            &texts
                .iter()
                .map(|t| json!({ "text": t }))
                .collect::<Vec<_>>(),
            "T",
            "x",
        );
        let t = find(&dir("r"), "project-status").unwrap();
        let r = render_local(&t, &note, &texts);
        let sections = r["sections"].as_array().unwrap();
        assert_eq!(sections.len(), 5);
        let items = |i: usize| sections[i]["items"].as_array().unwrap().len();
        assert!(items(1) >= 1, "risks: {r}");
        assert!(items(2) >= 1, "decisions");
        assert!(items(3) >= 1, "actions");
        assert!(items(4) >= 1, "questions");
        let md = r["markdown"].as_str().unwrap();
        assert!(md.contains("## Risks and issues") && md.contains("## Open questions"));
        // Prose style joins items into paragraphs, bullets use "- ".
        assert!(!md.contains("\n- "));
        assert!(markdown("bullets", sections).contains("\n- "));
    }

    #[test]
    fn a_connector_answer_is_split_back_into_the_templates_sections() {
        let t = find(&dir("p"), "general").unwrap();
        let p = system_prompt(&t);
        assert!(
            p.contains("## Summary") && p.contains("## Decisions") && p.contains("## Action items")
        );
        let answer = "## Summary\n- Launch is on Friday.\n\n## Decisions\n- Ship v2\n- Drop the beta\n\n## Action items\n_Nothing noted._\n";
        let parsed = parse_markdown(&t, answer);
        assert_eq!(parsed[0]["items"], json!(["Launch is on Friday."]));
        assert_eq!(parsed[1]["items"], json!(["Ship v2", "Drop the beta"]));
        assert_eq!(parsed[2]["items"], json!([]));
    }
}
