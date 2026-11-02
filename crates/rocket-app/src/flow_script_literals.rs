//! Resolves `{{name}}` placeholders inside string literals of flow script source.

use std::collections::HashMap;

/// Replaces `{{name}}` inside string literals with the escaped var value.
pub(crate) fn resolve_script_literals(source: &str, vars: &HashMap<String, String>) -> String {
    scan(source, &mut |name, quote| {
        vars.get(name).map(|value| escape_value(value, quote))
    })
}

/// True when a `{{process.env.…}}` name sits inside a string literal.
pub(crate) fn script_names_process_env(source: &str) -> bool {
    let mut found = false;
    scan(source, &mut |name, _| {
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
fn scan(source: &str, lookup: &mut dyn FnMut(&str, char) -> Option<String>) -> String {
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
                        match lookup(raw.trim(), quote) {
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
                if c == '\n' {
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

/// Finds the length of the name before the first `}}` that starts at `from`.
fn find_close(chars: &[char], from: usize) -> Option<usize> {
    (from..chars.len().saturating_sub(1))
        .find(|&j| chars[j] == '}' && chars[j + 1] == '}')
        .map(|j| j - from)
}

/// Escapes a value so it is safe inside a string with the given quote.
fn escape_value(value: &str, quote: char) -> String {
    let chars: Vec<char> = value.chars().collect();
    let mut out = String::with_capacity(value.len());
    for (i, &c) in chars.iter().enumerate() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            '$' if quote == '`' && chars.get(i + 1) == Some(&'{') => out.push_str("\\$"),
            c if c == quote => {
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
        assert_eq!(run("'{{pw}}'"), "'p\"w\\\\\\n'");
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
}
