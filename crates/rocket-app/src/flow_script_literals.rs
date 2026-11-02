//! Resolves `{{name}}` placeholders inside string literals of flow script source.

#[cfg(test)]
use std::collections::HashMap;

/// Replaces `{{name}}` inside string literals with the escaped var value.
#[cfg(test)]
pub(crate) fn resolve_script_literals(source: &str, vars: &HashMap<String, String>) -> String {
    resolve_script_literals_with(source, &mut |name| vars.get(name).cloned())
}

/// Like `resolve_script_literals`, with the values answered by `lookup`.
///
/// Every value `lookup` returns is escaped here and is never scanned again.
pub(crate) fn resolve_script_literals_with(
    source: &str,
    lookup: &mut dyn FnMut(&str) -> Option<String>,
) -> String {
    scan(source, &mut |name| {
        lookup(name).map(|value| escape_value(&value))
    })
}

/// True when a `{{process.env.…}}` name sits inside a string literal.
pub(crate) fn script_names_process_env(source: &str) -> bool {
    let mut found = false;
    scan(source, &mut |name| {
        if name.starts_with("process.env.") {
            found = true;
        }
        None
    });
    found
}

/// Scanner state: code with a brace depth, a string with its quote, or a comment.
enum State {
    Code(u32),
    Str(char),
    Line,
    Block,
}

/// Walks the source once and asks `lookup` for each placeholder inside a string.
///
/// Regex literals are not lexed, so a quote inside a regex can open a bogus
/// string. Values are escaped for every string kind and for `/`, so a value
/// cannot close a regex literal either.
fn scan(source: &str, lookup: &mut dyn FnMut(&str) -> Option<String>) -> String {
    let chars: Vec<char> = source.chars().collect();
    let mut out = String::with_capacity(source.len());
    let mut stack = vec![State::Code(0)];
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        match stack.last_mut() {
            Some(State::Str(quote)) => {
                let quote = *quote;
                if c == '\\' {
                    out.push(c);
                    if let Some(n) = next {
                        out.push(n);
                    }
                    i += 2;
                    continue;
                }
                if c == quote {
                    stack.pop();
                } else if quote == '`' && c == '$' && next == Some('{') {
                    out.push_str("${");
                    stack.push(State::Code(0));
                    i += 2;
                    continue;
                } else if c == '{' && next == Some('{') {
                    if let Some(len) = find_close(&chars, i + 2) {
                        let raw: String = chars[i + 2..i + 2 + len].iter().collect();
                        let end = i + 2 + len + 2;
                        match lookup(raw.trim()) {
                            Some(value) => out.push_str(&value),
                            None => out.extend(&chars[i..end]),
                        }
                        i = end;
                        continue;
                    }
                }
                out.push(c);
            }
            Some(State::Line) => {
                if matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}') {
                    stack.pop();
                }
                out.push(c);
            }
            Some(State::Block) => {
                if c == '*' && next == Some('/') {
                    out.push_str("*/");
                    stack.pop();
                    i += 2;
                    continue;
                }
                out.push(c);
            }
            _ => {
                match (c, next) {
                    ('/', Some('/')) => {
                        out.push_str("//");
                        stack.push(State::Line);
                        i += 2;
                        continue;
                    }
                    ('/', Some('*')) => {
                        out.push_str("/*");
                        stack.push(State::Block);
                        i += 2;
                        continue;
                    }
                    ('\'' | '"' | '`', _) => stack.push(State::Str(c)),
                    ('{', _) => {
                        if let Some(State::Code(d)) = stack.last_mut() {
                            *d += 1;
                        }
                    }
                    ('}', _) => {
                        let at_zero = matches!(stack.last(), Some(State::Code(0)));
                        if at_zero {
                            if stack.len() > 1 {
                                stack.pop();
                            }
                        } else if let Some(State::Code(d)) = stack.last_mut() {
                            *d -= 1;
                        }
                    }
                    _ => {}
                }
                out.push(c);
            }
        }
        i += 1;
    }
    out
}

/// Finds the length of a placeholder name before the first `}}` from `from`.
///
/// Returns `None` when a quote, backtick, backslash or newline comes first.
fn find_close(chars: &[char], from: usize) -> Option<usize> {
    let mut j = from;
    while j + 1 < chars.len() {
        match chars[j] {
            '}' if chars[j + 1] == '}' => return Some(j - from),
            '\'' | '"' | '`' | '\\' | '\n' | '\r' => return None,
            _ => j += 1,
        }
    }
    None
}

/// Escapes a value so it is inert inside any kind of JS string or regex literal.
pub(crate) fn escape_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            '\\' | '\'' | '"' | '`' | '$' | '/' => {
                out.push('\\');
                out.push(c);
            }
            c => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_closure_resolves_names() {
        let out = resolve_script_literals_with("return 'a={{a}}';", &mut |name| {
            (name == "a").then(|| "x'y".to_string())
        });
        assert_eq!(out, "return 'a=x\\'y';");
    }

    #[test]
    fn dynamic_name_comes_from_the_closure() {
        let out = resolve_script_literals_with("return '{{$guid}}';", &mut |name| {
            name.strip_prefix('$').map(|n| format!("dyn-{n}"))
        });
        assert_eq!(out, "return 'dyn-guid';");
    }

    fn vars() -> HashMap<String, String> {
        let mut m = HashMap::new();
        m.insert("username".to_string(), "ann".to_string());
        m.insert("pw".to_string(), "p\"w\\\n".to_string());
        m.insert("nested".to_string(), "{{username}}".to_string());
        m.insert("a".to_string(), "`${x}".to_string());
        m
    }

    fn run(s: &str) -> String {
        resolve_script_literals(s, &vars())
    }

    #[test]
    fn single_quote_string_is_replaced() {
        assert_eq!(run("return '{{username}}';"), "return 'ann';");
    }

    #[test]
    fn double_quote_string_is_replaced() {
        assert_eq!(run("return \"{{username}}\";"), "return \"ann\";");
    }

    #[test]
    fn template_string_is_replaced() {
        assert_eq!(run("`u={{username}}`"), "`u=ann`");
    }

    #[test]
    fn value_is_escaped_for_the_quote() {
        assert_eq!(run("'{{pw}}'"), "'p\\\"w\\\\\\n'");
        assert_eq!(run("\"{{pw}}\""), "\"p\\\"w\\\\\\n\"");
    }

    #[test]
    fn template_value_escapes_backtick_and_dollar_brace() {
        assert_eq!(run("`{{a}}`"), "`\\`\\${x}`");
    }

    #[test]
    fn comment_and_bare_code_are_left_alone() {
        let s = "// {{username}}\n/* {{username}} */ x({{username}})";
        assert_eq!(run(s), s);
    }

    #[test]
    fn template_hole_code_is_left_alone() {
        let s = "`a ${ f('{{username}}') + {{username}} } b {{username}}`";
        assert_eq!(run(s), "`a ${ f('ann') + {{username}} } b ann`");
    }

    #[test]
    fn unknown_name_stays() {
        assert_eq!(run("'{{nope}}'"), "'{{nope}}'");
    }

    #[test]
    fn replaced_value_is_not_scanned_again() {
        assert_eq!(run("'{{nested}}'"), "'{{username}}'");
    }

    #[test]
    fn escaped_quote_does_not_end_the_string() {
        assert_eq!(run("'it\\'s {{username}}'"), "'it\\'s ann'");
    }

    #[test]
    fn names_process_env_only_inside_strings() {
        assert!(script_names_process_env("'{{process.env.A}}'"));
        assert!(!script_names_process_env("x({{process.env.A}})"));
    }

    #[test]
    fn dollar_before_brace_cannot_open_a_hole() {
        let mut m = vars();
        m.insert("v".to_string(), "$".to_string());
        assert_eq!(resolve_script_literals("`{{v}}{x}`", &m), "`\\${x}`");
    }

    #[test]
    fn adjacent_placeholders_stay_inert() {
        let mut m = vars();
        m.insert("a".to_string(), "$".to_string());
        m.insert("b".to_string(), "{evil()}".to_string());
        assert_eq!(resolve_script_literals("`{{a}}{{b}}`", &m), "`\\${evil()}`");
    }

    #[test]
    fn open_braces_without_close_stay() {
        assert_eq!(run("'{{username'"), "'{{username'");
    }

    #[test]
    fn unterminated_string_does_not_panic() {
        assert_eq!(run("'a {{username}}"), "'a ann");
    }

    #[test]
    fn crafted_open_braces_do_not_desync() {
        let mut m = vars();
        m.insert("v".to_string(), "ok".to_string());
        assert_eq!(
            resolve_script_literals("'{{' ; x = \"{{v}}\"", &m),
            "'{{' ; x = \"ok\""
        );
    }

    #[test]
    fn regex_quote_keeps_value_inside_the_string() {
        let mut m = vars();
        m.insert("v".to_string(), "a\" + evil() + \"".to_string());
        assert_eq!(
            resolve_script_literals("/'/.test(s); \"{{v}}\"", &m),
            "/'/.test(s); \"a\\\" + evil() + \\\"\""
        );
    }

    #[test]
    fn slash_in_a_value_cannot_end_a_regex_literal() {
        let mut m = vars();
        m.insert("v".to_string(), "x/; evil(); /".to_string());
        assert_eq!(
            resolve_script_literals("/'{{v}}'/.test(body)", &m),
            "/'x\\/; evil(); \\/'/.test(body)"
        );
    }

    #[test]
    fn nested_template_hole_with_string_is_resolved() {
        let s = "`a ${ `b ${ '{{username}}' } c` } {{username}}`";
        assert_eq!(run(s), "`a ${ `b ${ 'ann' } c` } ann`");
    }

    #[test]
    fn line_comment_ends_at_carriage_return() {
        assert_eq!(run("// x\r'{{username}}'"), "// x\r'ann'");
    }
}
