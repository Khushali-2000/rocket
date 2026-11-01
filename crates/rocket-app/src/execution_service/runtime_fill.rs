//! The variable pass that runs after the pre-request scripts.
//!
//! The first resolution (`resolve_request_parts`) runs before any script, so it cannot see
//! runtime variables. It records each field as a `FieldTemplate`: the original text, the name of
//! every placeholder in it and the value the first pass put there. After the scripts,
//! `resolve_runtime_placeholders` renders each field the script did not rewrite again from that
//! template, with runtime values in place of the placeholders they name. Every other placeholder
//! keeps its first-pass value, so a `{{$dynamic}}` value is never made twice. A value is put in as
//! it is and never scanned for placeholders again.
//!
//! Text a script wrote is different: it has no template. In it only the names the first pass
//! could not resolve, and the names the script itself added, are filled, and never from the
//! RocketVault scope.
//!
//! A field a Flow wire or a fetched Auth-node token filled is recorded with
//! `FieldTemplate::literal`, so neither pass puts a value into it, even after a script
//! rewrote it: its text may come from a response.

use rocket_environment::resolve;
use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};

/// One request field as the first pass saw it.
#[derive(Debug, Clone, Default)]
pub(crate) struct FieldTemplate {
    /// The original text, before any variable was put in.
    text: String,
    /// The text is JSON (a GraphQL body), so values inside strings are JSON-escaped.
    json: bool,
    /// The trimmed name of each placeholder, in order.
    names: Vec<String>,
    /// The value the first pass put in for each placeholder, in order.
    values: Vec<String>,
    /// The text the first pass produced.
    pub output: String,
    /// The field is sent as written. See `FieldTemplate::literal`.
    literal: bool,
}

impl FieldTemplate {
    /// The `process.env.NAME` placeholders of the text, as `NAME`.
    pub(crate) fn process_env_names(&self) -> impl Iterator<Item = &str> {
        self.names
            .iter()
            .filter_map(|n| n.strip_prefix("process.env."))
    }

    /// A field sent as written. It has no placeholders, so neither pass puts a value into it,
    /// and the runtime pass leaves it as it is after a script rewrote it.
    pub(crate) fn literal(text: &str) -> Self {
        Self {
            text: text.to_string(),
            output: text.to_string(),
            literal: true,
            ..Self::default()
        }
    }

    /// The field is sent as written.
    pub(crate) fn is_literal(&self) -> bool {
        self.literal
    }

    /// Resolves `text` with `vars` and records what each placeholder became. The names no scope
    /// held are added to `unresolved`.
    pub(crate) fn record(
        text: &str,
        json: bool,
        vars: &HashMap<String, String>,
        unresolved: &mut HashSet<String>,
    ) -> Self {
        let names = RefCell::new(Vec::new());
        let values = RefCell::new(Vec::new());
        let missing = RefCell::new(Vec::new());
        let one = |placeholder: &str| -> String {
            let result = resolve(placeholder, vars);
            names.borrow_mut().push(placeholder_name(placeholder));
            values.borrow_mut().push(result.output.clone());
            missing.borrow_mut().extend(result.unresolved);
            result.output
        };
        let output = if json {
            crate::graphql_request::resolve_json_text(text, one)
        } else {
            substitute(text, |_, placeholder| one(placeholder))
        };
        unresolved.extend(missing.into_inner());
        Self {
            text: text.to_string(),
            json,
            names: names.into_inner(),
            values: values.into_inner(),
            output,
            literal: false,
        }
    }

    /// The text again: a placeholder whose name is in `overrides.values` gets that value, one
    /// whose name was removed gets its placeholder text back, and every other placeholder keeps
    /// its first value. A `$dynamic` name is never replaced.
    pub(crate) fn render(&self, overrides: &Overrides) -> String {
        let pick = |index: usize, placeholder: &str| -> String {
            let name = self
                .names
                .get(index)
                .map(String::as_str)
                .unwrap_or_default();
            if !name.starts_with('$') {
                if let Some(value) = overrides.values.get(name) {
                    return value.clone();
                }
                if overrides.removed.contains(name) {
                    return placeholder.to_string();
                }
            }
            self.values
                .get(index)
                .cloned()
                .unwrap_or_else(|| placeholder.to_string())
        };
        if self.json {
            let index = Cell::new(0);
            crate::graphql_request::resolve_json_text(&self.text, |placeholder| {
                let at = index.get();
                index.set(at + 1);
                pick(at, placeholder)
            })
        } else {
            substitute(&self.text, pick)
        }
    }
}

/// Replaces each `{{...}}` placeholder of `text` with `value(index, placeholder)`. It reads
/// placeholders exactly as `rocket_environment::resolve` does: `{{` up to the first `}}`, and
/// an unclosed `{{` is plain text.
fn substitute(text: &str, mut value: impl FnMut(usize, &str) -> String) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    let mut index = 0;
    while let Some(start) = rest.find("{{") {
        let Some(len) = rest[start + 2..].find("}}") else {
            break;
        };
        let end = start + 2 + len + 2;
        out.push_str(&rest[..start]);
        out.push_str(&value(index, &rest[start..end]));
        index += 1;
        rest = &rest[end..];
    }
    out.push_str(rest);
    out
}

/// The trimmed name inside a `{{...}}` placeholder.
fn placeholder_name(placeholder: &str) -> String {
    placeholder
        .strip_prefix("{{")
        .and_then(|s| s.strip_suffix("}}"))
        .unwrap_or(placeholder)
        .trim()
        .to_string()
}

/// The names of the placeholders in `text`, `$dynamic` names left out.
pub(crate) fn placeholder_names(text: &str) -> HashSet<String> {
    let mut names = HashSet::new();
    substitute(text, |_, placeholder| {
        let name = placeholder_name(placeholder);
        if !name.starts_with('$') {
            names.insert(name);
        }
        String::new()
    });
    names
}

/// Adds the names that `new` has and `old` does not to `allowed`. A name a script copied from
/// the request it was given (`req.getUrl()`) is not added, because it may come from inside a
/// variable value.
pub(crate) fn allow_new_names(allowed: &mut HashSet<String>, old: Option<&str>, new: &str) {
    let before = old.map(placeholder_names).unwrap_or_default();
    allowed.extend(
        placeholder_names(new)
            .into_iter()
            .filter(|n| !before.contains(n)),
    );
}

/// Fills the placeholders of script-written `text` whose name is a key of `vars`. Other
/// placeholders, `$dynamic` ones included, stay as written. Values are not scanned again.
pub(crate) fn fill_names(text: &str, vars: &HashMap<String, String>) -> String {
    if !text.contains("{{") {
        return text.to_string();
    }
    substitute(text, |_, placeholder| {
        vars.get(&placeholder_name(placeholder))
            .cloned()
            .unwrap_or_else(|| placeholder.to_string())
    })
}

/// Swaps path parameter values in a URL a script rewrote. Only the path is read: after the
/// scheme and authority, before `?` or `#`. One pass goes over its segments from left to right.
/// A segment equal to an old value, or starting with one and then a character that cannot be part
/// of a value (such as `.json`), gets the new value. Each segment changes at most once and the
/// new text is never read again. `swaps` holds (old encoded value, new encoded value) pairs.
pub(crate) fn swap_path_values(url: &str, swaps: &[(String, String)]) -> String {
    if swaps.is_empty() {
        return url.to_string();
    }
    let (start, end) = path_range(url);
    let mut ordered: Vec<&(String, String)> =
        swaps.iter().filter(|(old, _)| !old.is_empty()).collect();
    // A longer old value wins over a shorter one that is its prefix.
    ordered.sort_by_key(|(old, _)| std::cmp::Reverse(old.len()));
    let path = url[start..end]
        .split('/')
        .map(|segment| {
            for (old, new) in &ordered {
                if let Some(rest) = segment.strip_prefix(old.as_str()) {
                    let ends_value = rest.chars().next().is_none_or(|c| {
                        !(c.is_ascii_alphanumeric() || c == '_' || c == '%' || c == '-')
                    });
                    if ends_value {
                        return format!("{new}{rest}");
                    }
                }
            }
            segment.to_string()
        })
        .collect::<Vec<_>>()
        .join("/");
    format!("{}{}{}", &url[..start], path, &url[end..])
}

/// Byte range of the path in `url`, as `rocket_http::substitute_path_params` reads it.
fn path_range(url: &str) -> (usize, usize) {
    let is_delimiter = |c: char| matches!(c, '/' | '?' | '#');
    let after_scheme = url
        .find("://")
        .filter(|i| !url[..*i].contains(is_delimiter))
        .map_or(0, |i| i + 3);
    let start = url[after_scheme..]
        .find(is_delimiter)
        .map_or(url.len(), |i| after_scheme + i);
    let end = url[start..]
        .find(['?', '#'])
        .map_or(url.len(), |i| start + i);
    (start, end)
}

/// The first pass's templates of every field of a request, in request order.
#[derive(Debug, Clone, Default)]
pub(crate) struct RequestTemplates {
    /// The URL before path parameters were put in.
    pub url: FieldTemplate,
    /// The URL the first pass produced, path parameters included.
    pub url_output: String,
    /// Path parameter names and value templates.
    pub path_params: Vec<(String, FieldTemplate)>,
    /// Query key and value templates.
    pub query: Vec<(FieldTemplate, FieldTemplate)>,
    /// Header key and value templates, after collection and folder defaults applied.
    pub headers: Vec<(FieldTemplate, FieldTemplate)>,
    /// The body content template.
    pub body: Option<FieldTemplate>,
    /// Form-data value templates, by entry.
    pub form: Vec<FieldTemplate>,
    /// Auth field templates, in `map_auth_fields` order.
    pub auth: Vec<FieldTemplate>,
    /// Names a placeholder of the request text named that no scope held.
    pub unresolved: HashSet<String>,
    /// Header keys, lower case, whose values are sent as written.
    pub literal_headers: HashSet<String>,
    /// Each variable's stored value before any script ran, all scopes flattened, with no nested
    /// name filled.
    pub first_raw: HashMap<String, String>,
    /// Each variable's value before any script ran, with the nested names of the stored scopes
    /// filled. The second pass compares against it to find what the scripts changed.
    pub first_values: HashMap<String, String>,
    /// The `$dynamic` values the first pass made while it filled nested names, keyed with the
    /// `$`. The second pass reuses them, so a dynamic value is made once per send.
    pub nested_dynamic: HashMap<String, String>,
}

/// The values the pass after the pre-request scripts puts into placeholders.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Overrides {
    /// Names whose resolved value is new or changed since the first pass, every runtime name
    /// included, except `$dynamic` and `process.env.` names.
    pub values: HashMap<String, String>,
    /// Names that resolved in the first pass and resolve to nothing now.
    pub removed: HashSet<String>,
}

impl Overrides {
    /// Every runtime value, each name whose value in `now` differs from `first`, and each name
    /// `first` has and `now` lacks. `first` and `now` are flattened scopes, so scope order already
    /// decided each value. `$dynamic` and `process.env.` names are never listed.
    pub(crate) fn between(
        first: &HashMap<String, String>,
        now: &HashMap<String, String>,
        runtime: &HashMap<String, String>,
    ) -> Self {
        let listed = |name: &str| !name.starts_with('$') && !name.starts_with("process.env.");
        let mut values: HashMap<String, String> = runtime
            .iter()
            .filter(|(name, _)| listed(name))
            .map(|(name, value)| (name.clone(), value.clone()))
            .collect();
        for (name, value) in now {
            if listed(name) && first.get(name) != Some(value) {
                values.insert(name.clone(), value.clone());
            }
        }
        let removed = first
            .keys()
            .filter(|name| listed(name) && !now.contains_key(*name))
            .cloned()
            .collect();
        Self { values, removed }
    }

    /// Nothing changed since the first pass.
    pub(crate) fn is_empty(&self) -> bool {
        self.values.is_empty() && self.removed.is_empty()
    }
}

/// Matches the current key-value pairs to the templates in order, so that a pair a script
/// did not change is rendered from its template and any other pair is filled as script text.
/// A pair matches the first template, from the last match on, whose output equals it.
/// A changed value whose key is in `literal_keys` (lower case) is left as it is.
pub(crate) fn fill_pairs(
    pairs: &mut [(&mut String, &mut String)],
    templates: &[(FieldTemplate, FieldTemplate)],
    overrides: &Overrides,
    script_vars: &HashMap<String, String>,
    literal_keys: &HashSet<String>,
) {
    let mut cursor = 0;
    for (key, value) in pairs.iter_mut() {
        let found = templates[cursor.min(templates.len())..]
            .iter()
            .position(|(k, v)| k.output == **key && v.output == **value);
        match found {
            Some(offset) => {
                let (k, v) = &templates[cursor + offset];
                **key = k.render(overrides);
                **value = v.render(overrides);
                cursor += offset + 1;
            }
            None => {
                if !literal_keys.contains(&key.to_ascii_lowercase()) {
                    **value = fill_names(value, script_vars);
                }
                **key = fill_names(key, script_vars);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn ov(pairs: &[(&str, &str)]) -> Overrides {
        Overrides {
            values: vars(pairs),
            ..Overrides::default()
        }
    }

    #[test]
    fn render_puts_back_the_placeholder_of_a_removed_name() {
        let v = vars(&[("token", "old"), ("keep", "k")]);
        let mut unresolved = HashSet::new();
        let t = FieldTemplate::record("{{ token }}|{{keep}}", false, &v, &mut unresolved);
        assert_eq!(t.output, "old|k");
        let overrides = Overrides {
            removed: HashSet::from(["token".to_string()]),
            ..Overrides::default()
        };
        assert_eq!(t.render(&overrides), "{{ token }}|k");
    }

    #[test]
    fn render_in_json_text_fills_a_changed_name() {
        let v = vars(&[("token", "old")]);
        let mut unresolved = HashSet::new();
        let t = FieldTemplate::record(r#"{"t":"{{token}}"}"#, true, &v, &mut unresolved);
        assert_eq!(t.render(&ov(&[("token", "new")])), r#"{"t":"new"}"#);
    }

    #[test]
    fn overrides_list_runtime_changed_new_and_removed_names() {
        let first = vars(&[("a", "1"), ("b", "2"), ("gone", "x"), ("same", "s")]);
        let now = vars(&[
            ("a", "1"),
            ("b", "20"),
            ("fresh", "f"),
            ("same", "s"),
            ("r", "rv"),
        ]);
        let runtime = vars(&[("r", "rv")]);
        let o = Overrides::between(&first, &now, &runtime);
        assert_eq!(o.values, vars(&[("b", "20"), ("fresh", "f"), ("r", "rv")]));
        assert_eq!(o.removed, HashSet::from(["gone".to_string()]));
    }

    #[test]
    fn overrides_never_list_dynamic_or_process_env_names() {
        let first = vars(&[("process.env.HOME", "/a"), ("$odd", "1")]);
        let now = vars(&[("process.env.HOME", "/b"), ("process.env.NEW", "n")]);
        let runtime = vars(&[("$guid", "x"), ("process.env.X", "y")]);
        let o = Overrides::between(&first, &now, &runtime);
        assert!(o.is_empty(), "{o:?}");
    }

    #[test]
    fn a_higher_scope_hides_a_changed_env_value() {
        use rocket_environment::VariableContext;
        let mut ctx = VariableContext {
            env: vars(&[("E", "old"), ("R", "env-r")]),
            request: vars(&[("E", "req")]),
            runtime: vars(&[("R", "rt")]),
            ..VariableContext::default()
        };
        let first = ctx.flatten();
        ctx.env.insert("E".into(), "new".into());
        ctx.env.insert("R".into(), "env-r2".into());
        let o = Overrides::between(&first, &ctx.flatten(), &ctx.runtime);
        // Only the runtime name is listed, with its own value. E stays hidden by the request scope.
        assert_eq!(o.values, vars(&[("R", "rt")]));
        assert!(o.removed.is_empty());
    }

    #[test]
    fn literal_template_renders_its_text_unchanged() {
        let text = "https://e.test/{{apiKey}}?v={{vault.secret}}&id={{$guid}}";
        let t = FieldTemplate::literal(text);
        assert_eq!(t.output, text);
        assert_eq!(
            t.render(&ov(&[("apiKey", "x"), ("vault.secret", "s")])),
            text
        );
        assert_eq!(t.process_env_names().count(), 0);
    }

    #[test]
    fn record_matches_resolve_output() {
        let v = vars(&[("a", "1"), ("b", "{{c}}")]);
        for text in [
            "x{{a}}y{{ b }}z{{missing}}",
            "{{{a}}",
            "{{a}}}",
            "open {{ a",
            "{{a}b}}",
            "",
        ] {
            let mut unresolved = HashSet::new();
            let t = FieldTemplate::record(text, false, &v, &mut unresolved);
            assert_eq!(t.output, resolve(text, &v).output, "{text}");
        }
    }

    #[test]
    fn render_replaces_only_runtime_names_and_never_rescans_values() {
        let v = vars(&[("token", "old"), ("next", "https://evil/{{vault.k}}")]);
        let mut unresolved = HashSet::new();
        let t = FieldTemplate::record(
            "{{next}}?t={{token}}&id={{$guid}}",
            false,
            &v,
            &mut unresolved,
        );
        let first_id = t.output.rsplit('=').next().unwrap_or_default().to_string();
        let out = t.render(&ov(&[("token", "fresh"), ("vault.k", "secret")]));
        assert_eq!(
            out,
            format!("https://evil/{{{{vault.k}}}}?t=fresh&id={first_id}")
        );
    }

    #[test]
    fn fill_names_leaves_unknown_and_dynamic_names() {
        let out = fill_names("{{a}} {{b}} {{$guid}} {{ open", &vars(&[("a", "{{b}}")]));
        assert_eq!(out, "{{b}} {{b}} {{$guid}} {{ open");
    }

    #[test]
    fn swap_path_values_reads_only_the_path() {
        let swaps = vec![("1".to_string(), "42".to_string())];
        assert_eq!(
            swap_path_values("https://api1.test/items/1?page=1&x=1#1", &swaps),
            "https://api1.test/items/42?page=1&x=1#1"
        );
        assert_eq!(
            swap_path_values("https://h.test/files/1.json/12", &swaps),
            "https://h.test/files/42.json/12"
        );
    }

    #[test]
    fn swap_path_values_never_replaces_twice() {
        let swaps = vec![
            ("ab".to_string(), "cd".to_string()),
            ("d".to_string(), "zz".to_string()),
        ];
        assert_eq!(
            swap_path_values("https://h.test/ab/d?q=ab", &swaps),
            "https://h.test/cd/zz?q=ab"
        );
    }

    #[test]
    fn allow_new_names_skips_names_the_old_text_had() {
        let mut allowed = HashSet::new();
        allow_new_names(
            &mut allowed,
            Some("https://h/{{inner}}"),
            "https://h/{{inner}}/{{fresh}}",
        );
        assert_eq!(allowed, HashSet::from(["fresh".to_string()]));
    }
}
